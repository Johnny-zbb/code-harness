#!/usr/bin/env node
/**
 * Control-plane server for code-harness.
 *
 * Read path:  run.json / worker-events.jsonl / verifier-events.jsonl
 *             -> run-source adapter -> SSE -> UI
 * Command path: persistent task board -> isolated worker -> independent
 * verification -> human approval -> explicitly requested local merge.
 *
 * No dependencies: node:http + fs.watch.
 */

import http from "node:http";
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createMockSource } from "./mock-source.mjs";
import { createRunSource, discoverRuns } from "./run-source.mjs";
import { BoardError, createTaskBoard } from "./task-board.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, "..", "dist");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".patch": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
    } else {
      options[key] = next;
      i += 1;
    }
  }
  return options;
}

function resolveRunsDir(options) {
  if (typeof options["runs-dir"] === "string")
    return path.resolve(options["runs-dir"]);
  const candidates = [
    process.env.CODE_HARNESS_RUNS_DIR,
    path.resolve(process.cwd(), ".code-harness-runs"),
    path.resolve(process.cwd(), "..", ".code-harness-runs"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function pickRun(runsDir, wantedId) {
  const runs = discoverRuns(runsDir);
  if (!runs.length) return null;
  if (!wantedId) return runs[0];
  const hit = runs.find(
    (run) => run.runId === wantedId || run.runId.includes(wantedId),
  );
  if (!hit) throw new Error(`Run not found: ${wantedId}`);
  return hit;
}

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function plain(res, status, text) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(text);
}

function startSse(req, res, source) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
  res.write(": connected\n\n");

  const write = (event) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(": ping\n\n");
  }, 15000);
  const handle = source.start(write);

  req.on("close", () => {
    clearInterval(heartbeat);
    handle.cancel();
  });
}

async function serveFile(res, absPath) {
  const stat = await fsp.stat(absPath).catch(() => null);
  if (!stat?.isFile()) return false;
  const type =
    MIME[path.extname(absPath).toLowerCase()] ?? "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": type,
    "Cache-Control": "no-store",
  });
  res.end(await fsp.readFile(absPath));
  return true;
}

async function serveStatic(res, urlPath) {
  const relative = urlPath === "/" ? "/index.html" : urlPath;
  const candidate = path.resolve(distDir, `.${path.sep}${relative}`);
  if (candidate.startsWith(distDir) && (await serveFile(res, candidate)))
    return true;
  if (path.extname(relative)) return false;
  return serveFile(res, path.join(distDir, "index.html"));
}

async function readBody(req) {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new BoardError("请求需要 JSON。", 415);
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) throw new BoardError("请求内容过大。", 413);
    chunks.push(chunk);
  }
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new BoardError("JSON 格式无效。");
  }
  if (!value || Array.isArray(value) || typeof value !== "object")
    throw new BoardError("请求需要一个 JSON 对象。");
  return value;
}

function allowBoardRequest(req) {
  const localHost = new URL(`http://${req.headers.host}`);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(localHost.hostname))
    throw new BoardError("仅允许本机请求。", 403);
  const allowed = new Set([
    localHost.origin,
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ]);
  if (req.headers.origin && !allowed.has(req.headers.origin))
    throw new BoardError("请求来源无效。", 403);
  if (!req.headers.origin && req.headers["sec-fetch-site"] === "cross-site")
    throw new BoardError("请求来源无效。", 403);
}

function createHandler(options, board) {
  const forcedMock = Boolean(options.mock);

  return async function handler(req, res) {
    const url = new URL(req.url, "http://localhost");
    const { pathname } = url;

    if (pathname.startsWith("/api/board")) {
      try {
        allowBoardRequest(req);
        if (pathname === "/api/board" && req.method === "GET")
          return json(res, 200, await board.snapshot());
        if (pathname === "/api/board/tasks" && req.method === "POST")
          return json(res, 201, await board.create(await readBody(req)));
        const action = pathname.match(
          /^\/api\/board\/tasks\/([a-f0-9-]+)\/(rework|approve|merge|move)$/,
        );
        if (action && req.method === "POST") {
          const input = await readBody(req);
          return json(res, 200, await board[action[2]](action[1], input));
        }
        const artifact = pathname.match(
          /^\/api\/board\/tasks\/([a-f0-9-]+)\/attempts\/(\d+)\/file$/,
        );
        if (artifact && req.method === "GET") {
          const target = await board.artifact(
            artifact[1],
            artifact[2],
            url.searchParams.get("path") || "",
          );
          if (await serveFile(res, target)) return;
          throw new BoardError("证据文件不存在。", 404);
        }
        return json(res, 404, { error: "任务看板接口不存在。" });
      } catch (error) {
        return json(res, error.status || 500, { error: error.message });
      }
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      return res.end();
    }

    if (pathname.startsWith("/api/")) {
      // Live run lookup happens per request so new runs appear without a restart.
      const runsDir = resolveRunsDir(options);
      const runs = !forcedMock && runsDir ? discoverRuns(runsDir) : [];
      const mode = runs.length ? "live" : "mock";

      if (req.method === "POST") {
        // Step 6 of the plan: Start/Stop/Retry wire into the orchestrator.
        return json(res, 501, {
          error: "not implemented yet",
          detail:
            "Run commands (Start/Stop/Retry) land after the first real run, per the control-plane plan.",
        });
      }
      if (req.method !== "GET")
        return json(res, 405, { error: "method not allowed" });

      if (pathname === "/api/runs") {
        return json(res, 200, {
          mode,
          runs: runs.map(({ path: _path, ...rest }) => rest),
        });
      }

      if (
        pathname === "/api/events" ||
        /^\/api\/runs\/[^/]+\/events$/.test(pathname)
      ) {
        if (mode !== "live") return startSse(req, res, createMockSource());
        const wantedId = pathname.startsWith("/api/runs/")
          ? pathname.split("/")[3]
          : undefined;
        try {
          const run = pickRun(runsDir, wantedId);
          if (!run) return json(res, 404, { error: "no runs found" });
          return startSse(req, res, createRunSource(run.path));
        } catch (error) {
          return json(res, 404, { error: error.message });
        }
      }

      const fileMatch = pathname.match(/^\/api\/runs\/([^/]+)\/file$/);
      if (fileMatch) {
        const relative = url.searchParams.get("path") ?? "";
        if (mode !== "live") {
          // The demo run has no real artifacts; serve tiny placeholders so the
          // evidence links stay clickable during mock runs.
          if (/\.(png|jpe?g|webp)$/i.test(relative)) {
            const png = Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
              "base64",
            );
            res.writeHead(200, {
              "Content-Type": "image/png",
              "Content-Length": png.length,
              "Access-Control-Allow-Origin": "*",
            });
            return res.end(png);
          }
          return plain(
            res,
            200,
            `[mock evidence] ${relative}\nThis placeholder stands in for a real artifact during demo runs.`,
          );
        }
        let run;
        try {
          run = pickRun(runsDir, fileMatch[1]);
        } catch (error) {
          return json(res, 404, { error: error.message });
        }
        const runRoot = path.resolve(run.path);
        const target = path.resolve(runRoot, relative);
        if (target !== runRoot && !target.startsWith(runRoot + path.sep)) {
          return json(res, 400, { error: "invalid path" });
        }
        if (await serveFile(res, target)) return;
        return plain(res, 404, `evidence file not found: ${relative}`);
      }

      return json(res, 404, { error: `unknown api route: ${pathname}` });
    }

    if (req.method !== "GET")
      return json(res, 405, { error: "method not allowed" });
    if (await serveStatic(res, pathname)) return;
    return plain(
      res,
      404,
      "not found — build the UI first: npm run build (in apps/control-plane)",
    );
  };
}

export async function createControlPlane(options = {}) {
  const board =
    options.board ||
    (await createTaskBoard({
      dataDir:
        options["board-dir"] ||
        path.resolve(here, "../../../.code-harness-board"),
      defaultRepo: options.repo || path.resolve(here, "../../.."),
    }));
  const handler = createHandler(options, board);
  const server = http.createServer((req, res) =>
    handler(req, res).catch((error) => {
      console.error("[control-plane]", error.message);
      if (!res.headersSent) json(res, 500, { error: "服务请求失败。" });
      else res.end();
    }),
  );
  return { server, board };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const port = Number(options.port || 8787);
  const runsDir = resolveRunsDir(options);
  const mode =
    !options.mock && runsDir && discoverRuns(runsDir).length ? "live" : "mock";

  const { server, board } = await createControlPlane(options);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  }).catch(async (error) => {
    await board.close();
    throw error;
  });
  console.log(`[control-plane] listening on http://127.0.0.1:${port}`);
  console.log(
    `[control-plane] optional event viewer: ${mode}${mode === "live" ? ` (runs dir: ${runsDir})` : " (scripted demo run)"}`,
  );
  console.log(
    `[control-plane] task board: ${board.dataDir} (automatic Codex queue)`,
  );
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await board.close();
    server.closeAllConnections();
    server.close(() => {
      process.exitCode = 0;
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const invokedAsScript =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript)
  main().catch((error) => {
    console.error("[control-plane]", error.message);
    process.exitCode = 1;
  });
