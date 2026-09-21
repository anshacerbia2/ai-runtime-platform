export interface HostingInput {
  publicOrigin: string;
  appId: string;
  clientId: string;
  clientSecret: string;
  callbackUri: string;
  logoutUri: string;
  proxySecret: string;
}
export interface HostingConfig extends HostingInput {
  mountPath: string;
  cookieName: string;
  cookiePath: string;
  cookieSecure: boolean;
  cookieHttpOnly: boolean;
  cookieSameSite: string;
  frameAncestors: string;
}
export function hostingContract(input: HostingInput): HostingConfig;
