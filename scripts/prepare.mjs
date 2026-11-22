import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(path.join(root, "apps/web/package.json"));
const dest = path.join(root, "apps/web/public/runtime");
mkdirSync(dest, { recursive: true });
const py = path.dirname(require.resolve("pyodide"));
for (const name of readdirSync(py).filter((n) =>
  /^(pyodide\.mjs|pyodide\.asm\.(mjs|wasm)|pyodide-lock\.json|python_stdlib\.zip)$/.test(
    n,
  ),
))
  cpSync(path.join(py, name), path.join(dest, name));
cpSync(
  path.join(root, "apps/api/monolith/core.py"),
  path.join(dest, "core.py"),
);
const pdf = path.dirname(require.resolve("pdfjs-dist"));
for (const n of ["pdf.mjs", "pdf.worker.mjs"])
  cpSync(path.join(pdf, n), path.join(dest, n));
