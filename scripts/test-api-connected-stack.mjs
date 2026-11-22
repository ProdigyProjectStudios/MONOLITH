import { spawn } from "node:child_process";
import { once } from "node:events";
import { startRuntime } from "./observatory-test-runtime.mjs";

const s = await startRuntime();
try {
  const child = spawn(process.execPath, ["scripts/test-api-studio.mjs"], {
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME, CHROMIUM_PATH: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      MONOLITH_MODEL_CALLS_ENABLED:"0", QA_CONNECT_RUNTIME:"1",
      QA_WEB_ORIGIN:s.web, QA_API_ORIGIN:s.api, QA_WORKSPACE_TOKEN:s.token, QA_OTHER_TOKEN:s.other,
      REDIS_URL:s.redis, DATABASE_URL:s.database,
    },stdio:"inherit",
  });
  const [code] = await once(child,"exit");
  if (code!==0) throw Error("API-backed Studio checks failed.");
} finally {
  await s.stop();
}
