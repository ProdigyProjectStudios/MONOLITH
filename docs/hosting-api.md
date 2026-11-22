# Hosting MONOLITH

The production gateway serves the static frontend and the authenticated API on the same TLS origin. Visitors to the separate showcase can use Northstar locally in WebAssembly or connect their browser tab to an operator-provided HTTPS API. API, database, queue and provider credentials live on the server.

Build, deploy, back up and restore the persistent release using the [production operations runbook](production-operations.md). It covers separate staging and production profiles, digest-pinned images, role-scoped identity configuration, release checks, monitoring, migrations and rollback.

## Connect the separate showcase

1. Add the exact showcase HTTPS origin to the server's allowed origins alongside the production site origin.
2. In **Data sources → Investigation runtime**, enter the verified API origin and choose **Connect API**. Authenticate with a workspace bearer for the role and tenant you intend to use.
3. Choose **Check runtime** to inspect the worker and queue. The provider status shows configuration separately from a recorded model response.
4. In **Intelligence studio**, select a deterministic investigation or, on a deliberately enabled host, an AI investigation. Review its evidence and evaluation before approving a design. A live repeat starts a new provider execution on the saved input snapshot.

For model budget, rotation and runtime checks, see the [live runtime guide](live-runtime.md). For a public showcase recording, use the verified archive procedure in the [project README](../README.md).
