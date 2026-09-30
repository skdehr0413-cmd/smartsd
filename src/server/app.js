// HTTP 서버: REST API + 정적 파일. 외부 의존성 없이 node:http 로 구현한다.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from '../core/engine.js';
import { buildSeed } from '../core/seed.js';
import { emptyState } from '../core/model.js';
import { nowWall } from '../core/time.js';
import { FileStore, MemoryStore } from './store.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const CORE_DIR = path.join(ROOT, 'src/core');
const MAX_BODY = 1024 * 1024;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'SAMEORIGIN',
  'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'",
};

function send(res, status, body, headers = {}) {
  const isBuffer = Buffer.isBuffer(body);
  const payload = isBuffer || typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'content-type': isBuffer || typeof body === 'string' ? headers['content-type'] || 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'cache-control': 'no-cache',
    ...headers,
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size <= MAX_BODY) chunks.push(c); // 초과분은 버리면서 끝까지 읽은 뒤 413 으로 답한다
    });
    req.on('end', () => {
      if (size > MAX_BODY) return reject(Object.assign(new Error('요청 본문이 너무 큽니다(최대 1MB).'), { status: 413 }));
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('JSON 형식이 올바르지 않습니다.'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

async function serveStatic(res, baseDir, encodedRel) {
  let rel;
  try { rel = decodeURIComponent(encodedRel); } catch { return send(res, 400, 'Bad Request'); }
  const file = path.normalize(path.join(baseDir, rel));
  if (!file.startsWith(baseDir + path.sep) && file !== baseDir) return send(res, 403, 'Forbidden');
  try {
    const data = await fs.readFile(file);
    return send(res, 200, data, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  } catch {
    return send(res, 404, 'Not Found');
  }
}

/**
 * @param {object} opts
 * @param {string|null} opts.dataFile  JSON 파일 경로 (null 이면 메모리 저장)
 * @param {string|function} [opts.now] 고정 시각 또는 시계 함수 (테스트·데모 촬영용)
 * @param {'demo'|'empty'} [opts.seed]  데이터가 없을 때 채울 내용
 * @param {boolean} [opts.allowReset]   데모 초기화 API 허용 여부
 */
export function createApp({ dataFile = null, now, seed = 'demo', allowReset = true, company } = {}) {
  const clock = typeof now === 'function' ? now : now ? () => now : () => nowWall();
  const store = dataFile ? new FileStore(dataFile) : new MemoryStore();
  const fresh = () => (seed === 'demo' ? buildSeed(clock()) : emptyState(company));
  let state = store.load();
  if (!state) {
    state = fresh();
    store.save(state);
  }
  const engine = new Engine(state, { clock, onCommit: (s) => store.save(s) });

  async function handleApi(req, res, url) {
    const actorHeader = req.headers['x-actor'];
    let actor = '사무실';
    if (actorHeader) {
      try { actor = decodeURIComponent(String(actorHeader)).slice(0, 30) || actor; } catch { /* 잘못된 인코딩은 기본값 */ }
    }
    if (url.pathname === '/api/health') return send(res, 200, { ok: true, now: clock() });
    if (url.pathname === '/api/admin/reset' && req.method === 'POST') {
      if (!allowReset) return send(res, 403, { error: { code: 'FORBIDDEN', message: '초기화가 비활성화되어 있습니다.' } });
      engine.state = fresh();
      store.save(engine.state);
      return send(res, 200, { data: { ok: true }, state: engine.state, now: clock() });
    }
    const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
    const query = Object.fromEntries(url.searchParams);
    const includeState = req.headers['x-include-state'] === '1';
    const out = engine.handle(req.method, url.pathname, { body, query, actor, includeState });
    return send(res, out.status, { ...out.body, now: clock() });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed');
      if (url.pathname.startsWith('/core/')) return await serveStatic(res, CORE_DIR, url.pathname.slice('/core/'.length));
      const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      return await serveStatic(res, PUBLIC_DIR, rel);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error(err);
      return send(res, status, { error: { code: status === 500 ? 'INTERNAL' : 'BAD_REQUEST', message: status === 500 ? '서버 오류가 발생했습니다.' : err.message } });
    }
  });

  return { server, engine, clock };
}
