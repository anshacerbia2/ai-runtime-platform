export interface HostingInput {
  publicOrigin: string;
  appId: string;
  clientId: string;
  callbackUri: string;
  logoutUri: string;
}
export interface HostingConfig extends HostingInput {
  cookieName: string;
  cookiePath: '/';
  cookieSecure: true;
  cookieHttpOnly: true;
  cookieSameSite: 'Lax';
  frameAncestors: "'none'";
}
export function hostingContract(input: HostingInput): HostingConfig;
