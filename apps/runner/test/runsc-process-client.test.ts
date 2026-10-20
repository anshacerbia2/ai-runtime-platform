import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { RunscProcessClient } from '../src/runsc-process-client.js';
import { runscSandboxId } from '../src/runsc-sandbox-driver.js';

const linux = { skip: process.platform !== 'linux' };
async function fixture(t: TestContext, program = '') {
  const directory = await mkdtemp(
    join(await realpath(tmpdir()), 'runsc-process-'),
  );
  await chmod(directory, 0o700);
  const stateRoot = join(directory, 'state');
  const bundleRoot = join(directory, 'bundles');
  await mkdir(stateRoot, { mode: 0o700 });
  await mkdir(bundleRoot, { mode: 0o700 });
  // A separately pinned inert CLI double, never an alternate sandbox runtime.
  const executable = join(directory, 'inert-cli');
  const source = `#!${process.execPath}\n${
    program ||
    `
const args = process.argv.slice(2);
const operation = args[3];
if (operation === 'list') console.log('null');
else if (operation === 'state') console.log(JSON.stringify({args, env: process.env}));
else if (operation === 'run') setTimeout(() => process.exit(0), 80);
else process.exit(0);
`
  }`;
  await writeFile(executable, source, { mode: 0o700 });
  const options = {
    executable,
    stateRoot,
    bundleRoot,
    approvedExecutableSha256: createHash('sha256').update(source).digest('hex'),
    commandTimeoutMs: 2000,
    runTimeoutMs: 2000,
  };
  t.after(() => rm(directory, { recursive: true, force: true }));
  const identity = {
    assignmentId: randomUUID(),
    executionId: randomUUID(),
    attemptId: randomUUID(),
    runnerId: 'runner',
    ownerSubject: 'owner',
    bootId: randomUUID(),
    generation: 1,
    epoch: 1,
  };
  const sandboxId = runscSandboxId(identity);
  const record = { identity, sandboxId, bundle: join(bundleRoot, sandboxId) };
  const client = async (overrides = {}) => {
    const result = await RunscProcessClient.open({ ...options, ...overrides });
    t.after(() => result.close());
    return result;
  };
  return {
    directory,
    executable,
    stateRoot,
    bundleRoot,
    options,
    record,
    client,
  };
}

test(
  'unsupported hosts refuse before reading paths or executing anything',
  { skip: process.platform === 'linux' },
  async () => {
    await assert.rejects(
      RunscProcessClient.open({
        executable: 'invalid',
        stateRoot: 'invalid',
        bundleRoot: 'invalid',
        approvedExecutableSha256: 'invalid',
        commandTimeoutMs: 100,
        runTimeoutMs: 100,
      }),
      /unavailable/,
    );
  },
);

test(
  'native CLI uses only fixed flags and isolated environment; empty list is explicit',
  linux,
  async (t) => {
    const f = await fixture(t);
    const client = await f.client();
    assert.deepEqual(await client.list(), []);
    const value = (await client.readState(f.record)) as {
      args: string[];
      env: Record<string, string>;
    };
    assert.deepEqual(value.args, [
      `--root=${f.stateRoot}`,
      '--platform=systrap',
      '--network=none',
      'state',
      f.record.sandboxId,
    ]);
    assert.deepEqual(value.env, {
      PATH: '/usr/sbin:/usr/bin:/sbin:/bin',
      LANG: 'C',
    });
    await client.signalAll(f.record, 'TERM');
    await client.signalAll(f.record, 'KILL');
    await client.destroy(f.record);
    assert.throws(() => client.run({ ...f.record, bundle: '/unapproved' }));
    assert.throws(() => client.run({ ...f.record, sandboxId: 'foreign' }));
    await assert.rejects(client.signalAll(f.record, 'INT' as 'TERM'));
  },
);

test(
  'entrypoint approval and canonical private roots are required before execution',
  linux,
  async (t) => {
    const f = await fixture(t);
    await assert.rejects(
      f.client({ approvedExecutableSha256: '0'.repeat(64) }),
    );
    await assert.rejects(f.client({ stateRoot: `${f.stateRoot}/../state` }));
    await assert.rejects(f.client({ bundleRoot: f.stateRoot }));
    await chmod(f.stateRoot, 0o755);
    await assert.rejects(f.client());
    await chmod(f.stateRoot, 0o700);
    await chmod(f.executable, 0o722);
    await assert.rejects(f.client());
  },
);

test(
  'attached monitor starts synchronously, seals duplicate IDs and close drains accepted work',
  linux,
  async (t) => {
    const f = await fixture(t);
    const client = await f.client();
    const monitor = client.run(f.record);
    assert.throws(() => client.run(f.record));
    const closing = client.close();
    assert.throws(() => client.run(f.record));
    await assert.rejects(client.list());
    assert.deepEqual(await monitor.finished, { state: 'REAPED', code: 0 });
    await closing;
    assert.equal(client.recoveryRequired, false);
  },
);

test(
  'command timeout and output overflow reject without exposing child output and seal launches',
  linux,
  async (t) => {
    for (const program of [
      `setInterval(() => {}, 1000);`,
      `process.stderr.write('sensitive-child-text'.repeat(10000)); setInterval(() => {}, 1000);`,
      `process.stdout.write('{not-json}');`,
      `process.stdout.write('[{"id":"foreign","status":"alien"}]');`,
    ]) {
      const f = await fixture(t, program);
      const client = await f.client({ commandTimeoutMs: 200 });
      await assert.rejects(
        client.list(),
        (error: unknown) =>
          error instanceof Error &&
          error.message === 'Runsc process unavailable.',
      );
      assert.equal(client.recoveryRequired, true);
      assert.throws(() => client.run(f.record));
    }
  },
);

test(
  'monitor deadline/output failure stays LOST and commands remain available for explicit cleanup',
  linux,
  async (t) => {
    for (const body of [
      `setInterval(() => {}, 1000);`,
      `process.stdout.write('x'.repeat(1100000)); setInterval(() => {}, 1000);`,
    ]) {
      const f = await fixture(
        t,
        `if (process.argv[5] === 'run') { ${body} } else console.log('null');`,
      );
      const client = await f.client({ runTimeoutMs: 250 });
      const monitor = client.run(f.record);
      assert.deepEqual(await monitor.finished, { state: 'LOST', code: null });
      assert.equal(client.recoveryRequired, true);
      assert.deepEqual(await client.list(), []);
      await client.destroy(f.record);
    }
  },
);

test(
  'binary or root replacement is detected synchronously before another spawn',
  linux,
  async (t) => {
    const f = await fixture(t);
    const client = await f.client();
    await rename(f.executable, `${f.executable}.old`);
    await writeFile(f.executable, await readFile(`${f.executable}.old`), {
      mode: 0o700,
    });
    assert.throws(() => client.run(f.record));
    assert.equal(client.recoveryRequired, true);
    const other = await fixture(t);
    const second = await other.client();
    await rename(other.stateRoot, `${other.stateRoot}.old`);
    await mkdir(other.stateRoot, { mode: 0o700 });
    await assert.rejects(second.list());
    assert.throws(() => second.run(other.record));
  },
);

test(
  'control commands have bounded admission rather than an unbounded queue',
  linux,
  async (t) => {
    const f = await fixture(t, `setTimeout(() => console.log('null'), 120);`);
    const client = await f.client();
    const accepted = Array.from({ length: 4 }, () => client.list());
    await assert.rejects(client.list());
    await Promise.all(accepted);
    assert.equal(client.recoveryRequired, false);
  },
);

test(
  'a numeric nonzero guest status is reaped, not an invented transport loss or execution result',
  linux,
  async (t) => {
    const f = await fixture(t, 'process.exit(7);');
    const client = await f.client();
    assert.deepEqual(await client.run(f.record).finished, {
      state: 'REAPED',
      code: 7,
    });
    assert.equal(client.recoveryRequired, false);
    await assert.rejects(
      client.list(),
      (error: unknown) =>
        error instanceof Error &&
        error.message === 'Runsc process unavailable.',
    );
  },
);

test(
  'spawn failure retains a LOST monitor and never retries the same assignment',
  linux,
  async (t) => {
    const f = await fixture(t);
    const source = '#!/no-approved-interpreter-here\n';
    await writeFile(f.executable, source);
    const client = await f.client({
      approvedExecutableSha256: createHash('sha256')
        .update(source)
        .digest('hex'),
    });
    assert.deepEqual(await client.run(f.record).finished, {
      state: 'LOST',
      code: null,
    });
    assert.equal(client.recoveryRequired, true);
    assert.throws(() => client.run(f.record));
  },
);

test(
  'invalid UTF-8 and null state cannot masquerade as an authoritative observation',
  linux,
  async (t) => {
    const f = await fixture(t, `process.stdout.write(Buffer.from([0xff]));`);
    const first = await f.client();
    await assert.rejects(first.list());
    assert.equal(first.recoveryRequired, true);
    const g = await fixture(t, `console.log('null');`);
    const second = await g.client();
    await assert.rejects(second.readState(g.record));
    assert.equal(second.recoveryRequired, true);
  },
);
