# The operational field

Overview opens on a continuous relief of the selected report. Business Map keeps the original directed connectors for exploring individual relationships. Studio starts with a recorded stage sequence and offers a handoff map for inspecting relationships between specialists.

## Reading the Overview relief

- **Flow** emphasises each system’s longest median incoming activity interval and its observed handoffs. A copper seam locates the longest median among the displayed systems. Open a system label to see which activities formed the interval and inspect its middle source pair or pairs.
- **Volume** emphasises events per day. The full report sets the visual scale for replay. The relief places up to six of the busiest systems in the order they typically first appear in a case. Business Map includes the full system set.
- **The time strip** bins actual source events. Scrubbing selects up to seven days of arrivals within the report’s case population. Play advances through these windows. Full report restores the aggregate. The dates follow the records even when they differ from the nominal report window, which retains complete case traces.
- **The signal strip** opens the finding or the evidence for the selected interval. Report-wide metrics below the field retain their original case scope.

The mesh interpolates measured states when the user changes mode or time. The camera stays fixed so an increase is visible in the same location. Reduced motion applies the new measurements immediately. [Measurement projection](../../apps/web/components/relief/model.ts) · [Surface geometry](../../apps/web/components/relief/surface.ts)

## Reading the Business Map

| Mark | Interpretation |
| --- | --- |
| Membrane size | Relative count within the displayed layer. Labels give the actual count and unit. |
| Surface folds | Absolute imbalance of incoming and outgoing link weight divided by their sum. Zero connected weight gives baseline relief. Seven levels and stable entity identities make changes comparable across periods. |
| Directional filaments and moving particles | A relationship's source, destination and relative weight. Animation represents aggregate traffic for the selected window. Timestamped investigation playback uses the actual recorded sequence. |
| Amber crease | A measured pressure condition supplied by the view. In the operational twin the inspector shows the corresponding interval and source case. In a historical view it can represent an increase over the preceding epoch. |
| Violet | Investigation or proposed architecture context, identified in the accompanying view. |
| Focus | A selected entity or relationship and the neighbours that contribute evidence. Click or use the keyboard to inspect, pan, zoom, fit or recenter. |

A replay can change the apparent size of an entity even when its absolute count rises, because the reference maximum changes with the selected epoch. Use the numeric label and the source inspector for comparisons. Inferred ownership, projected architecture and synthetic changes retain their original labels. A measured interval describes elapsed time between events; it does not establish the cause of a delay.

## Business Map implementation

The renderer separates the data projection, stable layout and camera geometry, membrane rasterization, the cached base scene and moving signal marks. It projects folded three-dimensional surfaces into Canvas 2D. A same-origin worker prepares detailed surfaces off the main thread and transfers the finished bitmaps. The field displays an interactive low-cost outline during preparation. On browsers without the worker rendering APIs, rasterization yields to the main thread between time slices. HTML controls and labels provide keyboard focus and inspectable values, and an SVG fallback supports environments without a 2D canvas. Reduced motion preserves the direction cues, evidence and manual replay controls. An offscreen or hidden field suspends its signal loop. No external rendering or model service is required.

The main twin projects the current case set into five layers. Directed system links retain the row IDs of consecutive events. Historical views read the selected graph revision and its stored epoch counts. The Observatory derives positions from recorded stages and sequence numbers. The opportunity comparison plots matched cases against measured median preceding intervals; selecting a point focuses its finding. Choose **Open finding** for the source evidence.

## Reproduction

From the repository root, build the production export with `npm run build`. Run `node scripts/test-field-projection.mjs` to reconcile the source records and camera transforms. Run `node scripts/test-living-field.mjs` for the Chromium visual, interaction and rendering checks. Set `FIELD_QA_OUTPUT` to retain the viewport captures and measurements. Run `python scripts/release-acceptance.py --existing-build --output acceptance.json` for the broader application suite. Cross-engine checks use `MONOLITH_FIELD_ENGINE_QA=1 node scripts/test-browser-engines.mjs` with the installed Playwright browser binaries.

The portable private Site uses the synthetic showcase. The staging gateway serves the same frontend in its authenticated, server-backed profile. Neither profile requires paid model calls for this release.

## Earlier connector release verification

The following measurements were recorded for the connector-based release at `64e392e`. They describe the original map renderer and its staging installation.

In the Northstar fixture, four systems and ten directed handoffs reconcile with the grouped source events. In an isolated 920 × 390 Chromium field, detailed geometry initially blocked the main thread for 606 ms. On the final production export, worker-based preparation reduced the first field paint to 5.8 ms on desktop and 6.0 ms on mobile. The four completed sprites arrived after 785 ms and 997 ms respectively. Page startup included other long tasks. These figures are local measurements for this fixture.

The browser checks cover all nine workspaces, source drill-down, selected graph bounds, keyboard navigation, reduced motion, viewport changes, execution replay, no-canvas operation and suspension outside the viewport. Firefox desktop and WebKit with iPhone emulation both exercised worker rendering and the cooperative fallback. Native iPhone hardware, assistive-technology speech output and arbitrary large production tenants were outside the measured matrix.

Visual review of the rendered export found mobile label clipping, a chart label overlapping its neighbour's hit target, and React Flow hiding executed stages after a controlled update. The release checks reproduce those interactions. The final artifacts include a completed investigation graph with six visible stages and five links, and settled desktop and mobile maps.

The backend and authenticated browser regressions also exposed two timing issues in the test harness. The ingestion test now waits for the accepted batch's background snapshot before checking rollback of a conflicting batch. The streaming test captures the real browser fetch response as it arrives. It validates ordered SSE frames independently of Chromium's DevTools response cache.

[Release gate receipts and build fingerprint](evidence/living-field.json)
