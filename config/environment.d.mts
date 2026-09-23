export interface RuntimeEnvironment {
  readonly localOperatorToken?: string;
  readonly localRunnerToken?: string;
  readonly hosting?: import('./hosting.mjs').HostingConfig;
  readonly oidc?: {
    issuer: string;
    audience: string;
    jwksUri: string;
    operatorClientId: string;
    runnerClientId?: string;
  };
  readonly runtimeMode: string;
  readonly apiHost: string;
  readonly apiPort: number;
  readonly webHost: string;
  readonly webPort: number;
  readonly allowedHosts: readonly string[];
  readonly allowedOrigins: readonly string[];
  readonly apiBodyLimitBytes: number;
  readonly apiRequestTimeoutMs: number;
  readonly database: {
    readonly host: string;
    readonly port: number;
    readonly name: string;
    readonly user: string;
    readonly password: string;
    readonly managePostgres: boolean;
    readonly pgBin: string;
    readonly dataDir: string;
    readonly logFile: string;
    readonly poolMax: number;
    readonly connectionTimeoutMs: number;
    readonly idleTimeoutMs: number;
    readonly statementTimeoutMs: number;
    readonly applicationName: string;
  };
  readonly databaseUrl: string;
  readonly seedTxMaxWaitMs: number;
  readonly seedTxTimeoutMs: number;
  readonly dev: {
    readonly apiReadyTimeoutMs: number;
    readonly apiProbeTimeoutMs: number;
    readonly apiPollIntervalMs: number;
    readonly childStopTimeoutMs: number;
    readonly postgresStartTimeoutSeconds: number;
  };
  readonly applications: readonly {
    readonly id: string;
    readonly name: string;
    readonly token: string;
  }[];
  readonly playwright: {
    readonly browserName: string;
    readonly channel: string;
    readonly timeoutMs: number;
    readonly webServerTimeoutMs: number;
    readonly viewportWidth: number;
    readonly viewportHeight: number;
    readonly reuseExistingServer: boolean;
  };
}

export function loadEnvironment(): RuntimeEnvironment;
export const projectRoot: string;

export interface WebEnvironment {
  readonly runtimeMode: string;
  readonly local: boolean;
  readonly webHost: string;
  readonly webPort: number;
  readonly publicOrigin: string;
  readonly allowedOrigins: readonly string[];
  readonly apiOrigin: string;
  readonly requestTimeoutMs: number;
  readonly bodyLimitBytes: number;
  readonly responseLimitBytes: number;
  readonly docsRoot: string;
  readonly applicationToken?: string;
  readonly operatorToken?: string;
  readonly hosting?: import('./hosting.mjs').HostingConfig;
  readonly auth?: {
    issuer: string;
    jwksUri: string;
    audience: string;
    clientSecret: string;
    scopes: string[];
    sessionSecret: string;
    redisUrl: string;
    sessionTtlSeconds: number;
    loginTtlSeconds: number;
    refreshSkewSeconds: number;
    lockMs: number;
    lockWaitMs: number;
    lockPollMs: number;
    redisConnectTimeoutMs: number;
  };
}
export function loadWebEnvironment(): WebEnvironment;

export function loadSessionTestEnvironment(): {
  url: string;
  timeoutMs: number;
};

export function loadPactEnvironment(): Readonly<{
  url: string;
  version: string;
  environment: string;
  branch: string;
  token?: string;
  timeoutMs: number;
  loopback: boolean;
}>;
