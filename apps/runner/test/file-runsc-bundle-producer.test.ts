import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { FileRunscBundleProducer } from '../src/file-runsc-bundle-producer.js';
import {
  rootfsManifestDigest,
  type RootfsManifest,
} from '../src/runsc-bundle.js';

const linux = { skip: process.platform !== 'linux' };
const binding = () => ({
  assignmentId: randomUUID(),
  executionId: randomUUID(),
  attemptId: randomUUID(),
  runnerId: 'runner',
  ownerSubject: 'owner',
  bootId: randomUUID(),
  generation: 1,
  epoch: 1,
});
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'runsc-bundle-'));
  const imageRoot = join(root, 'image');
  const bundleRoot = join(root, 'bundles');
  await mkdir(imageRoot, { mode: 0o700 });
  await mkdir(bundleRoot, { mode: 0o700 });
  for (const name of ['bin', 'dev', 'proc', 'tmp']) {
    await mkdir(join(imageRoot, name), { mode: 0o700 });
  }
  await writeFile(join(imageRoot, 'bin/program'), 'fixture', { mode: 0o555 });
  for (const name of ['bin', 'dev', 'proc', 'tmp']) {
    await chmod(join(imageRoot, name), 0o555);
  }
  const manifest: RootfsManifest = {
    format: 'ai-runtime-rootfs/v1',
    architecture: process.arch as 'x64' | 'arm64',
    directories: ['bin', 'dev', 'proc', 'tmp'],
    files: [
      {
        path: 'bin/program',
        bytes: 7,
        sha256: createHash('sha256').update('fixture').digest('hex'),
        executable: true,
      },
    ],
  };
  const options = {
    imageRoot,
    bundleRoot,
    manifest,
    approvedRootfsDigest: rootfsManifestDigest(manifest),
    programs: { agent: ['/bin/program'] },
  };
  t.after(async () => {
    // Only this test's owned temporary tree; restore directory write access.
    async function writable(path: string) {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          const next = join(path, entry.name);
          await chmod(next, 0o700);
          await writable(next);
        }
      }
    }
    await writable(root);
    await rm(root, { recursive: true, force: true });
  });
  const open = async () => {
    const producer = await FileRunscBundleProducer.open(options);
    t.after(() => producer.close());
    return producer;
  };
  return { root, imageRoot, bundleRoot, options, open };
}

test(
  'unsupported hosts refuse before filesystem access',
  { skip: process.platform === 'linux' },
  async () => {
    await assert.rejects(
      FileRunscBundleProducer.open({
        imageRoot: 'missing',
        bundleRoot: 'missing',
        manifest: {} as RootfsManifest,
        approvedRootfsDigest: '',
        programs: {},
      }),
      /unavailable/,
    );
  },
);

test(
  'approved image produces readonly independent bytes, pinned config, exact binding and one bundle',
  linux,
  async (t) => {
    const f = await fixture(t);
    const producer = await f.open();
    const identity = binding();
    const captured = { ...identity };
    const pending = producer.prepare(identity, 'agent');
    identity.bootId = randomUUID();
    const [first, replay] = await Promise.all([
      pending,
      producer.prepare(captured, 'agent'),
    ]);
    assert.deepEqual(first, replay);
    assert.equal((await readdir(f.bundleRoot)).length, 1);
    assert.deepEqual(await producer.verify(captured, 'agent'), first);
    const file = join(first.record.bundle, 'rootfs/bin/program');
    assert.equal(await readFile(file, 'utf8'), 'fixture');
    assert.equal((await stat(file)).mode & 0o777, 0o555);
    assert.notEqual(
      (await stat(file)).ino,
      (await stat(join(f.imageRoot, 'bin/program'))).ino,
    );
    assert.equal(
      first.configDigest,
      `sha256:${createHash('sha256')
        .update(await readFile(join(first.record.bundle, 'config.json')))
        .digest('hex')}`,
    );
    await assert.rejects(producer.prepare({ ...captured, epoch: 2 }, 'agent'));
  },
);

test(
  'wrong approval/architecture or unapproved program refuses before creating a bundle',
  linux,
  async (t) => {
    const f = await fixture(t);
    await assert.rejects(
      FileRunscBundleProducer.open({
        ...f.options,
        approvedRootfsDigest: `sha256:${'0'.repeat(64)}`,
      }),
    );
    await assert.rejects(
      FileRunscBundleProducer.open({
        ...f.options,
        programs: { agent: ['/bin/missing'] },
      }),
    );
    const producer = await f.open();
    await assert.rejects(producer.prepare(binding(), 'not-approved'));
    assert.deepEqual(await readdir(f.bundleRoot), []);
  },
);

test(
  'corrupt, writable, linked or undeclared image content never publishes an approved bundle',
  linux,
  async (t) => {
    for (const mode of ['bytes', 'writable', 'symlink', 'hardlink', 'extra']) {
      const f = await fixture(t);
      const producer = await f.open();
      const path = join(f.imageRoot, 'bin/program');
      if (mode === 'bytes') {
        await chmod(path, 0o755);
        await writeFile(path, 'changed');
        await chmod(path, 0o555);
      }
      if (mode === 'writable') {
        await chmod(path, 0o755);
      }
      if (mode === 'extra') {
        await writeFile(join(f.imageRoot, 'unapproved'), 'secret', {
          mode: 0o444,
        });
      }
      if (mode === 'symlink' || mode === 'hardlink') {
        const outside = join(f.root, 'outside');
        await writeFile(outside, 'fixture', { mode: 0o555 });
        await chmod(join(f.imageRoot, 'bin'), 0o700);
        await unlink(path);
        if (mode === 'symlink') {
          await symlink(outside, path);
        } else {
          await link(outside, path);
        }
        await chmod(join(f.imageRoot, 'bin'), 0o555);
      }
      const identity = binding();
      await assert.rejects(producer.prepare(identity, 'agent'));
      await assert.rejects(producer.prepare(identity, 'agent'));
      await assert.rejects(producer.prepare(binding(), 'agent'));
    }
  },
);

test(
  'verification rejects config, manifest, rootfs bytes, permissions and extra files after production',
  linux,
  async (t) => {
    for (const mode of ['config', 'manifest', 'bytes', 'mode', 'extra']) {
      const f = await fixture(t);
      const producer = await f.open();
      const identity = binding();
      const made = await producer.prepare(identity, 'agent');
      const path =
        mode === 'config'
          ? join(made.record.bundle, 'config.json')
          : mode === 'manifest'
            ? join(made.record.bundle, 'image-manifest.json')
            : join(made.record.bundle, 'rootfs/bin/program');
      if (mode === 'extra') {
        await writeFile(join(made.record.bundle, 'unapproved'), 'x', {
          mode: 0o400,
        });
      } else if (mode === 'mode') {
        await chmod(path, 0o755);
      } else {
        await chmod(path, 0o600);
        await writeFile(path, 'changed');
        await chmod(path, mode === 'bytes' ? 0o555 : 0o400);
      }
      await assert.rejects(producer.verify(identity, 'agent'));
    }
  },
);

test(
  'reopen is readonly, verifies old bundles but never adopts an existing directory for new launch',
  linux,
  async (t) => {
    const f = await fixture(t);
    const first = await FileRunscBundleProducer.open(f.options);
    const identity = binding();
    const made = await first.prepare(identity, 'agent');
    await first.close();
    const recovered = await f.open();
    assert.equal(recovered.recoveryRequired, true);
    assert.deepEqual(await recovered.verify(identity, 'agent'), made);
    await assert.rejects(recovered.prepare(identity, 'agent'), /recovery/);
    await assert.rejects(recovered.prepare(binding(), 'agent'), /recovery/);
  },
);

test(
  'nested readonly directories and nonexecutable files retain exact bytes and modes',
  linux,
  async (t) => {
    const f = await fixture(t);
    await mkdir(join(f.imageRoot, 'usr'), { mode: 0o700 });
    await mkdir(join(f.imageRoot, 'usr/lib'), { mode: 0o700 });
    await writeFile(join(f.imageRoot, 'usr/lib/config'), 'data', {
      mode: 0o444,
    });
    await chmod(join(f.imageRoot, 'usr/lib'), 0o555);
    await chmod(join(f.imageRoot, 'usr'), 0o555);
    f.options.manifest = {
      ...f.options.manifest,
      directories: [...f.options.manifest.directories, 'usr', 'usr/lib'],
      files: [
        ...f.options.manifest.files,
        {
          path: 'usr/lib/config',
          bytes: 4,
          sha256: createHash('sha256').update('data').digest('hex'),
          executable: false,
        },
      ],
    };
    f.options.approvedRootfsDigest = rootfsManifestDigest(f.options.manifest);
    const producer = await f.open();
    const identity = binding();
    const made = await producer.prepare(identity, 'agent');
    assert.equal(
      (await stat(join(made.record.bundle, 'rootfs/usr/lib/config'))).mode &
        0o777,
      0o444,
    );
    assert.equal(
      (await stat(join(made.record.bundle, 'rootfs/usr/lib'))).mode & 0o777,
      0o555,
    );
    await producer.verify(identity, 'agent');
  },
);

test(
  'intake is bounded and close seals callers while draining accepted preparations',
  linux,
  async (t) => {
    const f = await fixture(t);
    const producer = await f.open();
    const accepted = Array.from({ length: 4 }, () =>
      producer.prepare(binding(), 'agent'),
    );
    await assert.rejects(producer.prepare(binding(), 'agent'), /capacity/);
    const closing = producer.close();
    await assert.rejects(producer.prepare(binding(), 'agent'));
    assert.equal((await Promise.all(accepted)).length, 4);
    await closing;
    assert.equal((await readdir(f.bundleRoot)).length, 4);
  },
);
