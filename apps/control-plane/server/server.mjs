#!/usr/bin/env node
/**
 * Control-plane server for code-harness.
 *
 * Read path:  run.json / worker-events.jsonl / verifier-events.jsonl
 *             -> run-source adapter -> SSE -> UI
 * Command path (step 6 of the plan): plain HTTP POST endpoints; currently
 * stubs so the UI contract is stable before real Start/Stop/Retry land.
 *
 * No dependencies: node:http + fs.watch.
 */

import http from 'node:http';
import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createMockSource } from './mock-source.mjs';
import { createRunSource, discoverRuns } from './run-source.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, '..', 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.patch': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      options[key] = true;
    } else {
      options[key] = next;
      i += 1;
    }
  }
  return options;
}

function resolveRunsDir(options) {
  if (typeof options['runs-dir'] === 'string') return path.resolve(options['runs-dir']);
  const candidates = [
    process.env.CODE_HARNESS_RUNS_DIR,
    path.resolve(process.cwd(), '.code-harness-runs'),
    path.resolve(process.cwd(), '..', '.code-harness-runs'),
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
  const hit = runs.find((run) => run.runId === wantedId || run.runId.includes(wantedId));
  if (!hit) throw new Error(`Run not found: ${wantedId}`);
  return hit;
}

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function plain(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(text);
}

function startSse(req, res, source) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  res.write(': connected\n\n');

  const write = (event) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 15000);
  const handle = source.start(write);

  req.on('close', () => {
    clearInterval(heartbeat);
    handle.cancel();
  });
}

async function serveFile(res, absPath) {
  const stat = await fsp.stat(absPath).catch(() => null);
  if (!stat?.isFile()) return false;
  const type = MIME[path.extname(absPath).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(await fsp.readFile(absPath));
  return true;
}

async function serveStatic(res, urlPath) {
  const relative = urlPath === '/' ? '/index.html' : urlPath;
  const candidate = path.resolve(distDir, `.${path.sep}${relative}`);
  if (candidate.startsWith(distDir) && (await serveFile(res, candidate))) return true;
  if (path.extname(relative)) return false;
  return serveFile(res, path.join(distDir, 'index.html'));
}

function createHandler(options) {
  const forcedMock = Boolean(options.mock);

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      return res.end();
    }

    if (pathname.startsWith('/api/')) {
      // Live run lookup happens per request so new runs appear without a restart.
      const runsDir = resolveRunsDir(options);
      const runs = !forcedMock && runsDir ? discoverRuns(runsDir) : [];
      const mode = runs.length ? 'live' : 'mock';

      if (req.method === 'POST') {
        // Step 6 of the plan: Start/Stop/Retry wire into the orchestrator.
        return json(res, 501, {
          error: 'not implemented yet',
          detail: 'Run commands (Start/Stop/Retry) land after the first real run, per the control-plane plan.',
        });
      }
      if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });

      if (pathname === '/api/runs') {
        return json(res, 200, { mode, runs: runs.map(({ path: _path, ...rest }) => rest) });
      }

      if (pathname === '/api/events' || /^\/api\/runs\/[^/]+\/events$/.test(pathname)) {
        if (mode !== 'live') return startSse(req, res, createMockSource());
        const wantedId = pathname.startsWith('/api/runs/') ? pathname.split('/')[3] : undefined;
        try {
          const run = pickRun(runsDir, wantedId);
          if (!run) return json(res, 404, { error: 'no runs found' });
          return startSse(req, res, createRunSource(run.path));
        } catch (error) {
          return json(res, 404, { error: error.message });
        }
      }

      const fileMatch = pathname.match(/^\/api\/runs\/([^/]+)\/file$/);
      if (fileMatch) {
        const relative = url.searchParams.get('path') ?? '';
        if (mode !== 'live') {
          // The demo run has no real artifacts; serve tiny placeholders so the
          // evidence links stay clickable during mock runs.
          if (/\.(png|jpe?g|webp)$/i.test(relative)) {
            const png = Buffer.from(
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
              'base64',
            );
            res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length, 'Access-Control-Allow-Origin': '*' });
            return res.end(png);
          }
          return plain(res, 200, `[mock evidence] ${relative}\nThis placeholder stands in for a real artifact during demo runs.`);
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
          return json(res, 400, { error: 'invalid path' });
        }
        if (await serveFile(res, target)) return;
        return plain(res, 404, `evidence file not found: ${relative}`);
      }

      return json(res, 404, { error: `unknown api route: ${pathname}` });
    }

    if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });
    if (await serveStatic(res, pathname)) return;
    return plain(res, 404, 'not found — build the UI first: npm run build (in apps/control-plane)');
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const port = Number(options.port || 8787);
  const runsDir = resolveRunsDir(options);
  const mode = !options.mock && runsDir && discoverRuns(runsDir).length ? 'live' : 'mock';

  const server = http.createServer(createHandler(options));
  server.listen(port, '127.0.0.1', () => {
    console.log(`[control-plane] listening on http://127.0.0.1:${port}`);
    console.log(`[control-plane] mode: ${mode}${mode === 'live' ? ` (runs dir: ${runsDir})` : ' (scripted demo run)'}`);
  });
}

const invokedAsScript = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) main();
