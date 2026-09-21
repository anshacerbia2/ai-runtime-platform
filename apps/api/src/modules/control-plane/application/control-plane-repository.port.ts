export interface ApplicationView {
  id: string;
  displayName: string;
  environment: string;
  keycloakClientId: string;
  status: 'ENABLED' | 'DISABLED';
}

export interface ConnectionView {
  id: string;
  displayName: string;
  provider: string;
  authMode: string;
  environment: string;
  sharingMode: 'DEDICATED' | 'SHARED';
  quotaGroupRef: string | null;
  status: 'ENABLED' | 'DISABLED';
  credentialInstances: number;
}

export interface BindingView {
  id: string;
  applicationId: string;
  connectionId: string;
  profileRef: string | null;
  status: 'ENABLED' | 'DISABLED';
}

export interface ControlPlaneRepository {
  listApplications(): Promise<ApplicationView[]>;
  listConnections(): Promise<ConnectionView[]>;
  listBindings(): Promise<BindingView[]>;
}

export const CONTROL_PLANE_REPOSITORY = Symbol('CONTROL_PLANE_REPOSITORY');
