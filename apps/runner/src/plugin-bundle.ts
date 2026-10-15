import { mkdir, lstat, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import {
  PluginBundleError,
  validatePluginBundle,
  type TrustedPluginGrant,
} from '@ai-runtime/plugin-package';
export {
  PluginBundleError,
  type TrustedPluginGrant,
} from '@ai-runtime/plugin-package';

export interface MaterializedPlugin {
  directory: string;
  packageId: string;
  version: string;
  digest: string;
  files: readonly string[];
}

/** Run before plugin code starts, inside a private sandbox root. */
export async function materializePluginBundle(
  sandboxRoot: string,
  bundleBytes: Uint8Array,
  grant: TrustedPluginGrant,
): Promise<MaterializedPlugin> {
  const { bundle, files } = validatePluginBundle(bundleBytes, grant);
  const root = resolve(sandboxRoot);
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new PluginBundleError('Sandbox root is not a private directory.');
  }
  const destination = join(root, `plugin-${grant.digest}`);
  await mkdir(destination, { mode: 0o700 });
  for (const file of files) {
    const path = resolve(destination, ...file.path.split('/'));
    if (!path.startsWith(destination + sep)) {
      throw new PluginBundleError('Plugin file escaped sandbox root.');
    }
    await mkdir(resolve(path, '..'), { recursive: true, mode: 0o700 });
    await writeFile(path, file.bytes, { flag: 'wx', mode: 0o400 });
  }
  return {
    directory: destination,
    packageId: bundle.packageId,
    version: bundle.version,
    digest: grant.digest,
    files: files.map((file) => file.path),
  };
}
