# Control Plane, AI Connections, dan Distributed Runner Fleet

```mermaid
flowchart LR
    App["Application<br/>Keycloak identity"] --> API["AI Runtime API"]
    Admin["Admin UI"] --> CP["Control Plane"]
    API --> CP
    CP --> AR["Application + Profile Registry"]
    CP --> CR["AI Connection + Credential Bindings"]
    CP --> PR["Plugin Registry"]
    CP --> RR["Runner Registry / Pools"]
    CP --> SCH["Placement Scheduler"]
    SCH --> A["Runner A<br/>Claude + connection X"]
    SCH --> B["Runner B<br/>Claude + connection X"]
    SCH --> C["Runner C<br/>OpenAI + connection Y"]
    V["Vault / Secret Manager"] -. central credential .-> A
    V -. central credential .-> C
    B -. runner-local credential .-> BX["Local Secret Store"]
    A --> Providers["AI Providers / Runtimes"]
    B --> Providers
    C --> Providers
    Redis["Redis<br/>runner lease/capacity"] <--> RR
    PG["PostgreSQL<br/>durable registry/config"] <--> CP
```

## Placement rule

Eligible runner = runtime compatible + application/profile authorized + AI connection available + credential locality satisfied + capacity + environment/region/data policy + version compatible + lifecycle `RUNNING`.

Multiple runner bindings may represent one logical AI Connection and one upstream quota group. More runners therefore do not automatically imply more provider quota.

Plugin/workspace are optional execution capabilities. Plugin artifacts are resolved from the registry and materialized only inside isolated workers. Remote app-owned tools may use MCP or typed HTTP/RPC.
