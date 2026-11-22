/** Loopback-only test stack with a new SQLite database, authenticated workspaces and a dedicated Redis/RQ queue. */
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const dir = path.join(root, "apps/api");
const python = path.join(dir, ".venv/bin/python");
const baseEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  PYTHONUNBUFFERED: "1",
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function childPort(script, args, env, children, started) {
  const proc = spawn(python, ["-u", "-c", script, ...args], {
    cwd: dir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(proc);
  started?.(proc);
  let stderr = "";
  proc.stderr.on("data", (v) => {
    stderr = (stderr + String(v)).slice(-1500);
  });
  const reader = createInterface({ input: proc.stdout });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Local QA server did not start: " + stderr)),
      30000,
    );
    proc.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.once("exit", (code) => {
      children.delete(proc);
      clearTimeout(timer);
      reject(Error("QA server exited " + code + ": " + stderr));
    });
    reader.on("line", (line) => {
      if (/^PORT \d+$/.test(line)) {
        clearTimeout(timer);
        resolve("http://127.0.0.1:" + line.slice(5));
      }
    });
  });
}
async function terminate(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exit = once(child, "exit");
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
  await exit.finally(() => clearTimeout(timer));
}
export async function startRuntime() {
  const dirTmp = await mkdtemp(path.join(tmpdir(), "monolith-observatory-"));
  const children = new Set();
  const token = randomBytes(24).toString("hex"),
    other = randomBytes(24).toString("hex");
  let container;
  const stop = async () => {
    const ending = [...children].map(terminate);
    await Promise.allSettled(ending);
    if (container)
      await exec("docker", ["rm", "-f", container]).catch(() => {});
    await rm(dirTmp, { force: true, recursive: true });
  };
  try {
    const id = await exec("docker", [
      "run",
      "--pull=missing",
      "--rm",
      "-d",
      "-p",
      "127.0.0.1::6379",
      "redis:7-alpine",
      "redis-server",
      "--save",
      "",
      "--appendonly",
      "no",
    ]);
    container = id.stdout.trim();
    const port = (await exec("docker", ["port", container, "6379/tcp"])).stdout
      .trim()
      .split(":")
      .at(-1);
    if (!/^\d+$/.test(port)) throw Error("Missing isolated Redis port");
    const web = await childPort(
      `
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from functools import partial
import sys
s=ThreadingHTTPServer(("127.0.0.1",0),partial(SimpleHTTPRequestHandler,directory=sys.argv[1]))
print("PORT",s.server_address[1]);s.serve_forever()
`,
      [path.join(root, "dist")],
      baseEnv,
      children,
    );
    const env = {
      ...baseEnv,
      DATABASE_URL: "sqlite:///" + path.join(dirTmp, "fixture.db"),
      REDIS_URL: "redis://127.0.0.1:" + port,
      TENANT_TOKENS: JSON.stringify({ northstar: token, other }),
      WEB_ORIGINS: web,
      MONOLITH_ENV: "production",
    };
    let apiProcess, workerProcess;
    async function bootApi(reusePort = 0) {
      const api = await childPort(
        `
import socket,sys,uvicorn
from monolith.main import app
s=socket.socket();s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);s.bind(("127.0.0.1",int(sys.argv[1])));s.listen(64)
print("PORT",s.getsockname()[1])
uvicorn.Server(uvicorn.Config(app,access_log=False,log_level="warning")).run(sockets=[s])
`,
        [String(reusePort)],
        env,
        children,
        (proc) => {
          apiProcess = proc;
        },
      );
      let ok = false;
      for (let i = 0; i < 160 && !ok; i++) {
        try {
          ok = (await fetch(api + "/api/health")).ok;
        } catch {}
        if (!ok) await pause(100);
      }
      if (!ok) throw Error("Isolated API health check failed");
      return api;
    }
    const api = await bootApi();
    const startWorker = () => {
      const proc = spawn(
        path.join(dir, ".venv/bin/rq"),
        [
          "worker",
          "--worker-class",
          "monolith.runtime_worker.MonolithWorker",
          "--url",
          env.REDIS_URL,
          "monolith",
        ],
        { cwd: dir, env, stdio: "ignore" },
      );
      children.add(proc);
      workerProcess = proc;
      proc.once("exit", () => children.delete(proc));
    };
    async function restart() {
      const hadWorker = Boolean(workerProcess);
      await Promise.all([terminate(apiProcess), terminate(workerProcess)]);
      await bootApi(Number(new URL(api).port));
      if (hadWorker) startWorker();
    }
    return { api, web, token, other, redis:env.REDIS_URL, database:env.DATABASE_URL, startWorker, restart, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
