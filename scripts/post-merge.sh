#!/bin/bash
set -e

# MONOLITH is an npm workspaces repository (root + apps/web).
npm ci --no-audit --no-fund

# Copies the Pyodide runtime, the portable analysis modules and the PDF
# worker into apps/web/public/runtime/ so the browser workspace can run
# the bundled Northstar analysis without any provider key.
npm run prepare:runtime
