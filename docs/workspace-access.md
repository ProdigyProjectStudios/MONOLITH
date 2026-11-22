# Workspace access

The API resolves every bearer credential to one tenant, actor and role. It checks permission before reading a protected request body and scopes storage queries to the authenticated tenant. A workspace header or query parameter cannot select a different tenant. The public health endpoints return service status. HubSpot’s public OAuth launch and callback require the one-use administrator-authorized transaction and first-party browser binding.

## Configure identities

Set `MONOLITH_ENV=production` and inject `TENANT_IDENTITIES` into the API through your deployment’s secret configuration. Each tenant maps actor IDs to credentials and roles. The following values illustrate the format.

```json
{
  "northstar": {
    "finance-reader": {"token": "<independent random secret>", "role": "viewer"},
    "ops-analyst": {"token": "<second independent secret>", "role": "analyst"},
    "finance-reviewer": {"token": "<third independent secret>", "role": "approver"},
    "workspace-owner": {"token": "<fourth independent secret>", "role": "admin"}
  }
}
```

Give each person or service a distinct stable actor ID and independently generated high-entropy token. Use at least 32 random bytes for newly issued credentials. Deliver each token privately, use HTTPS, and keep the full identity configuration out of browser bundles, logs and repositories. Removing an actor or rotating its token takes effect when the API reloads its environment. An unfinished HubSpot OAuth transaction also requires its initiating actor to retain connector-administration permission through completion.

| Capability | Viewer | Analyst | Approver | Admin |
| --- | :---: | :---: | :---: | :---: |
| Read tenant records, evidence, reports, graph, stage progress and simulations | Yes | Yes | Yes | Yes |
| Upload source documents and events, run deterministic investigations and refresh monitoring | | Yes | | Yes |
| Review opportunities and approve a verified eligible blueprint | | | Yes | Yes |
| Manage external connector authorizations, sync and disconnect | | | | Yes |
| Inspect operational metrics/readiness, export tenant data and request a funded model run | | | | Yes |

The provider opt-in switch, server credentials, budgets and verification gates still apply to administrators. A workspace administrator’s export contains only that workspace. The separate offline deployment commands use host-level operator access.

## Migrate shared credentials

The legacy `TENANT_TOKENS` JSON mapping remains supported. A legacy token has the `admin` role with actor ID `shared-workspace-token`. A shared token can establish tenant-level attribution only. To migrate one workspace, replace its legacy entry with named members and deploy both configuration changes together. Other workspaces may continue using legacy entries in the same deployment. Startup rejects duplicate tokens, duplicate JSON keys, unknown roles and overlapping legacy/named entries for a tenant.

Production requires at least one configured tenant. An unconfigured development API labels its local Northstar identity `development-demo` and restricts operational, connector and model controls to authenticated members.

## Verify access and attribution

Read `GET /api/workspace?include_data=false` with the user's bearer credential to obtain the effective `identity.actor`, `role`, `permissions`, legacy flag and source revision. The read-only report endpoint accepts `GET /api/report?days=30`. To retrieve larger datasets, page `GET /api/records` by `kind` (`events`, `sources`, or `docs`), `limit` (up to 500), and `revision`. Pass the returned `next_cursor` as `after` for each following page. A 409 means source data changed during the read. Fetch fresh metadata and restart all kinds at the new revision.

Missing or invalid credentials receive HTTP 401. A valid identity without the required permission receives HTTP 403. Permitted tenant-scoped lookups return HTTP 404 for inaccessible records. Responses carrying tenant data request private, uncached handling.

New audit entries record actor and role. Blueprint approvals preserve the first approver with the approved design and timestamp, including in the tenant’s continuous decision memory. Older audit rows preserve their original data with empty actor fields. Public approved-replay exports retain the decision and approval time while omitting workspace actor identifiers.
