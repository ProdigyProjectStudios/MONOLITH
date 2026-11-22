import { cpSync, rmSync } from "node:fs";
const dest = new URL("../dist/", import.meta.url);
rmSync(dest, { recursive: true, force: true });
cpSync(new URL("../apps/web/out/", import.meta.url), dest, { recursive: true });
