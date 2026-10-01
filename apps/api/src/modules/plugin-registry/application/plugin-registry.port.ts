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

/** No production implementation exists until object bytes and provenance are verified. */
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
