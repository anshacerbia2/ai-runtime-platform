import { createHash } from 'node:crypto';
import { mkdir, lstat, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

const SHA256 = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const SCOPED_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const SEGMENT = /^[A-Za-z0-9._-]{1,64}$/;
const MAX_BUNDLE_BYTES = 16 * 1024 * 1024;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_FILES = 256;

export interface TrustedPluginGrant {
  packageId: string;
  version: string;
  digest: string;
  state: 'ACTIVE' | 'REVOKED';
  runtimeVersion: string;
  allowedPermissions: readonly string[];
}

interface BundleFile {
  path: string;
  sha256: string;
  contentBase64: string;
}

interface PluginBundle {
  format: 'ai-runtime-plugin/v1';
  packageId: string;
  version: string;
  compatibleRuntimeVersions: string[];
  requiredPermissions: string[];
  files: BundleFile[];
}

export interface MaterializedPlugin {
  directory: string;
  packageId: string;
  version: string;
  digest: string;
  files: readonly string[];
}

export class PluginBundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginBundleError';
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && IDENTIFIER.test(value);
}

function runtimeIdentifier(value: unknown): value is string {
  return typeof value === 'string' && SCOPED_IDENTIFIER.test(value);
}

function permissionIdentifier(value: unknown): value is string {
  return typeof value === 'string' && SCOPED_IDENTIFIER.test(value);
}

function safePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 240) {
    return false;
  }
  const parts = value.split('/');
  return (
    parts.length >= 1 &&
    parts.length <= 8 &&
    parts.every(
      (part) =>
        SEGMENT.test(part) &&
        part !== '.' &&
        part !== '..' &&
        !/[. ]$/.test(part) &&
        !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part),
    )
  );
}

function parseBundle(bytes: Uint8Array, grant: TrustedPluginGrant) {
  if (
    bytes.byteLength < 2 ||
    bytes.byteLength > MAX_BUNDLE_BYTES ||
    !SHA256.test(grant.digest) ||
    sha256(bytes) !== grant.digest ||
    grant.state !== 'ACTIVE'
  ) {
    throw new PluginBundleError('Plugin digest or grant is invalid.');
  }
  let parsed: unknown;
  try {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    parsed = JSON.parse(source);
    if (JSON.stringify(parsed) !== source) {
      throw new Error('Noncanonical plugin bundle.');
    }
  } catch {
    throw new PluginBundleError('Plugin bundle is not canonical UTF-8 JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new PluginBundleError('Plugin manifest is invalid.');
  }
  const value = parsed as Record<string, unknown>;
  if (
    value.format !== 'ai-runtime-plugin/v1' ||
    !identifier(value.packageId) ||
    !identifier(value.version) ||
    value.packageId !== grant.packageId ||
    value.version !== grant.version ||
    !Array.isArray(value.compatibleRuntimeVersions) ||
    !value.compatibleRuntimeVersions.every(runtimeIdentifier) ||
    !value.compatibleRuntimeVersions.includes(grant.runtimeVersion) ||
    !Array.isArray(value.requiredPermissions) ||
    !value.requiredPermissions.every(permissionIdentifier) ||
    !value.requiredPermissions.every((permission) =>
      grant.allowedPermissions.includes(permission),
    ) ||
    !Array.isArray(value.files) ||
    value.files.length < 1 ||
    value.files.length > MAX_FILES
  ) {
    throw new PluginBundleError('Plugin manifest is incompatible with grant.');
  }
  const bundle = value as unknown as PluginBundle;
  const seen = new Set<string>();
  const files: Array<{ path: string; bytes: Uint8Array }> = [];
  let total = 0;
  for (const file of bundle.files) {
    if (
      !file ||
      !safePath(file.path) ||
      !SHA256.test(file.sha256) ||
      typeof file.contentBase64 !== 'string' ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        file.contentBase64,
      ) ||
      seen.has(file.path.toLowerCase())
    ) {
      throw new PluginBundleError('Plugin file path or encoding is invalid.');
    }
    const content = Buffer.from(file.contentBase64, 'base64');
    total += content.byteLength;
    if (
      content.byteLength < 1 ||
      content.byteLength > MAX_FILE_BYTES ||
      total > MAX_BUNDLE_BYTES ||
      content.toString('base64') !== file.contentBase64 ||
      sha256(content) !== file.sha256
    ) {
      throw new PluginBundleError('Plugin file checksum or size is invalid.');
    }
    seen.add(file.path.toLowerCase());
    files.push({ path: file.path, bytes: content });
  }
  for (const file of files) {
    const lower = file.path.toLowerCase();
    if (
      files.some(
        (other) =>
          other !== file && lower.startsWith(other.path.toLowerCase() + '/'),
      )
    ) {
      throw new PluginBundleError('Plugin file conflicts with a directory.');
    }
  }
  return { bundle, files };
}

/** Run before plugin code starts, inside a private sandbox root. */
export async function materializePluginBundle(
  sandboxRoot: string,
  bundleBytes: Uint8Array,
  grant: TrustedPluginGrant,
): Promise<MaterializedPlugin> {
  const { bundle, files } = parseBundle(bundleBytes, grant);
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
