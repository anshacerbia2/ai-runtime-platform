export interface PluginPackageIdentity {
  applicationId: string;
  packageId: string;
  version: string;
}

export interface StagedPluginPackage extends PluginPackageIdentity {
  bundleDigest: string;
  objectKey: string;
  bundleBytes: number;
  compatibleRuntimeVersions: readonly string[];
  requiredPermissions: readonly string[];
}

export interface PluginPackageRecord extends StagedPluginPackage {
  state: 'STAGED' | 'ACTIVE' | 'REVOKED';
  attestationRef: string | null;
  revision: number;
}

export interface PluginPackageAttestation {
  bundleDigest: string;
  attestationRef: string;
}

/** Activation requires verified stored bytes and an app-authorized signer. */
export interface PluginPackageVerifier {
  verify(staged: PluginPackageRecord): Promise<PluginPackageAttestation>;
}

export interface PluginPackageRepository {
  stage(command: StagedPluginPackage): Promise<PluginPackageRecord>;
  find(identity: PluginPackageIdentity): Promise<PluginPackageRecord | null>;
  activate(
    identity: PluginPackageIdentity,
    expectedRevision: number,
    attestation: PluginPackageAttestation,
  ): Promise<PluginPackageRecord>;
  revoke(
    identity: PluginPackageIdentity,
    expectedRevision: number,
  ): Promise<PluginPackageRecord>;
}

export interface PluginPackageBytesStore {
  /** Returns a caller-owned buffer; consumers may erase it after use. */
  get(
    key: string,
    maximumBytes: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array | null>;
}

export interface PluginSigningKeyResolver {
  resolve(
    applicationId: string,
    keyId: string,
    signal?: AbortSignal,
  ): Promise<string | null>;
}

export interface VerifiedPluginPackageReader {
  readVerified(record: PluginPackageRecord): Promise<{
    bytes: Uint8Array;
    attestation: PluginPackageAttestation;
  }>;
}
