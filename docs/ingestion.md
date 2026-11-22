# Source ingestion

An authenticated API workspace accepts event batches, CSV logs, text PDFs and read-only HubSpot deal observations. Event and document IDs resolve inside the workspace that imported them. A committed change also records a source revision for the continuous monitor.

## Custom event batches

Send `POST /api/events` with `Content-Type: application/json` and a workspace bearer token with `sources:write`. The endpoint accepts 1–1,000 events in a request of at most 1 MiB. The request schema is available in the API's OpenAPI document.

```json
{
  "source": "Dispatch event feed",
  "events": [
    {
      "event_id": "ticket-971-assigned",
      "case_id": "ticket-971",
      "activity": "Dispatch assigned",
      "timestamp": "2026-11-01T10:42:00Z",
      "system": "Service desk",
      "department": "Dispatch"
    }
  ]
}
```

Every event requires the first five fields shown. Department is optional. Add a top-level `"synthetic": true` for generated or training feeds. The source and its imported events then carry that designation. MONOLITH normalises case identifiers to uppercase and timestamps to UTC seconds, using the same convention as uploaded CSV logs. The producing system and its external event ID determine the canonical event ID across both transports. Each new JSON event retains the source label, the original event ID, a unique row locator in that feed, a SHA-256 digest of its normalised batch and its one-based position within that submission.

A response contains `source_id`, `received`, `added`, `event_ids` in request order and `replayed`. An atomic transaction persists new rows, the source, the monitor revision and the request receipt. An existing event with conflicting canonical data rejects the entire batch with HTTP 409.

Clients can supply an `Idempotency-Key` header of 1–128 ASCII letters, digits, periods, colons, plus signs, underscores or hyphens. Retrying a matching batch and key returns the original receipt with `replayed: true`. Its `added` count describes the original commit. Reusing a key for a different payload returns 409. Each workspace has its own key namespace. Without a key, a duplicate batch still deduplicates individual events and returns the count added by that request.

Validation failures return 422. Unsupported media types return 415. A body exceeding 1 MiB returns 413. Authentication, authorisation and rate-limit failures return 401, 403 and 429 respectively.

## CSV and text PDF uploads

Use `POST /api/upload` with one `file` field in a multipart form. The API enforces a 6 MiB file limit while reading the request. A CSV must be UTF-8, use distinct column headings, contain at most 25,000 rows and have consistent field counts. The required columns are `case_id`, `activity`, `timestamp` and `system`. The optional columns `event_id`, `department`, `hubspot_deal_id` and `hubspot_portal_id` support stable producer IDs, ownership and explicit deal correlation.

PDFs require a PDF header, an unencrypted document and extractable text. A separate Linux Python process parses each document with an empty environment, a 384 MiB address-space limit, 8 seconds of CPU time and a 12-second wall-clock timeout. Each API worker admits two PDF parses at once. Further requests receive 429 with a retry delay. The parser accepts up to 100 pages and retains up to 20,000 characters per page. Scanned images need OCR before import. Evidence remains addressable by source and page.

## HubSpot connection lifecycle

A workspace administrator opens **Data sources → HubSpot deals → Connect HubSpot**. Configure the OAuth app's exact callback, client ID and secret, and a persistent Fernet `HUBSPOT_TOKEN_KEY` on the server. The connector requests `crm.objects.deals.read`. OAuth's standard `oauth` scope is accepted alongside it. The connector rejects additional grants, including for server-managed private apps. Tokens obtained through OAuth remain encrypted and bound to their workspace and portal. Server-supplied rotating refresh tokens also require the encryption key. Operators manage private-app secrets in the server's secret store.

**Sync deals** verifies the account before storing observations and commits each page with its checkpoint. **Continue sync** resumes bounded work against the same upper modification timestamp. Each successful incremental run advances its watermark. Its next run overlaps the last two minutes and deduplicates observations. The connector honours an HTTP 429 retry delay up to seven days and persists it across requests and service restarts. The status endpoint and UI expose the earliest retry time. Transport and 5xx failures receive bounded retries.

**Disconnect account** removes the workspace-managed credential locally or disables a server-managed credential for this workspace. **Revoke HubSpot grant** explicitly asks HubSpot to invalidate a workspace-managed OAuth refresh grant. Sync pauses before the revocation request. An unconfirmed revocation leaves the encrypted credential available for retry. Confirmed revocation deletes the local credential. Both actions keep existing source evidence. Administrators manage revocation of server-supplied private-app credentials in HubSpot. [HubSpot's OAuth revocation API](https://developers.hubspot.com/changelog/v1-oauth-api-deprecation)

A provider acceptance run requires an authorised HubSpot sandbox, an installed app, a registered callback, a workspace administrator and permission to read its deals and revoke the test grant. Local protocol tests use controlled HTTP responses and exercise real callback handling, encryption, persistence, paging, rate limits and revocation. A real sandbox install, read and confirmed revocation are still required to verify a specific account.

### Sandbox acceptance

1. Use a dedicated workspace and a HubSpot test portal containing a known deal. Start consent from Data sources, complete the registered callback and compare the displayed portal ID and granted scopes with the test account.
2. Run **Sync deals** and continue any pending pages. Open the imported deal observation and compare its portal, deal ID, recorded stage and modification time with the source. Record the completed watermark.
3. Repeat the incremental sync during an unchanged interval. Check that it adds zero observations. If a sandbox operator changes a deal, sync again and inspect the newly timestamped observation and the original record.
4. Select **Disconnect**, then **Revoke HubSpot grant**. Check for provider confirmation, the local **Grant revoked** state and the retained imported evidence. Save UTC times, aggregate counts and status outcomes in the release record. Keep credentials, callback codes, provider response bodies and customer record contents out of that record.
