import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UI_PATH = join(ROOT, 'ui', 'index.html');

function readJSON(file) {
  const p = join(ROOT, file);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

function writeJSON(file, data) {
  JSON.parse(JSON.stringify(data));
  writeFileSync(join(ROOT, file), JSON.stringify(data, null, 2) + '\n');
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e6) reject(new Error('Too large')); });
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON')); } });
  });
}

function handleNgwords(req, res) {
  if (req.method === 'GET') {
    const pub = readJSON('ngwords.public.json') || { patterns: [] };
    const priv = readJSON('ngwords.private.json') || { words: [] };
    return send(res, 200, { patterns: pub.patterns || [], words: priv.words || [] });
  }

  if (req.method === 'POST') {
    return parseBody(req).then(body => {
      if (body.type === 'public') {
        const pub = readJSON('ngwords.public.json') || { patterns: [] };
        pub.patterns = pub.patterns || [];
        const id = body.id || `custom-${Date.now()}`;
        pub.patterns.push({ id, category: body.category || 'pii', regex: body.regex, severity: body.severity || 'block' });
        writeJSON('ngwords.public.json', pub);
        return send(res, 200, { ok: true, id });
      }
      if (body.type === 'private') {
        const priv = readJSON('ngwords.private.json') || { words: [] };
        priv.words = priv.words || [];
        if (priv.words.some(w => w.value === body.value)) return send(res, 409, { error: 'Already exists' });
        priv.words.push({ value: body.value, category: body.category || 'customer', severity: body.severity || 'block' });
        writeJSON('ngwords.private.json', priv);
        return send(res, 200, { ok: true });
      }
      return send(res, 400, { error: 'type must be "public" or "private"' });
    }).catch(e => send(res, 400, { error: e.message }));
  }

  if (req.method === 'DELETE') {
    return parseBody(req).then(body => {
      if (body.type === 'public') {
        const pub = readJSON('ngwords.public.json') || { patterns: [] };
        pub.patterns = (pub.patterns || []).filter(p => p.id !== body.id);
        writeJSON('ngwords.public.json', pub);
        return send(res, 200, { ok: true });
      }
      if (body.type === 'private') {
        const priv = readJSON('ngwords.private.json') || { words: [] };
        priv.words = (priv.words || []).filter(w => w.value !== body.value);
        writeJSON('ngwords.private.json', priv);
        return send(res, 200, { ok: true });
      }
      return send(res, 400, { error: 'type must be "public" or "private"' });
    }).catch(e => send(res, 400, { error: e.message }));
  }

  return send(res, 405, { error: 'Method not allowed' });
}

function handleWhitelist(req, res) {
  if (req.method === 'GET') {
    const pub = readJSON('ngwords-whitelist.json') || { words: [] };
    const local = readJSON('ngwords-whitelist.local.json') || { words: [] };
    return send(res, 200, { public: pub.words || [], local: local.words || [] });
  }

  if (req.method === 'POST') {
    return parseBody(req).then(body => {
      const file = body.file === 'local' ? 'ngwords-whitelist.local.json' : 'ngwords-whitelist.json';
      const data = readJSON(file) || { words: [] };
      data.words = data.words || [];
      const word = body.word?.trim();
      if (!word) return send(res, 400, { error: 'word is required' });
      if (data.words.includes(word)) return send(res, 409, { error: 'Already exists' });
      data.words.push(word);
      data.words.sort();
      writeJSON(file, data);
      return send(res, 200, { ok: true });
    }).catch(e => send(res, 400, { error: e.message }));
  }

  if (req.method === 'DELETE') {
    return parseBody(req).then(body => {
      const file = body.file === 'local' ? 'ngwords-whitelist.local.json' : 'ngwords-whitelist.json';
      const data = readJSON(file) || { words: [] };
      data.words = (data.words || []).filter(w => w !== body.word);
      writeJSON(file, data);
      return send(res, 200, { ok: true });
    }).catch(e => send(res, 400, { error: e.message }));
  }

  return send(res, 405, { error: 'Method not allowed' });
}

function handleAllowlist(req, res) {
  if (req.method === 'GET') {
    const pub = readJSON('allowlist.json') || { allow: [] };
    const local = readJSON('allowlist.local.json') || { allow: [] };
    return send(res, 200, { public: pub.allow || [], local: local.allow || [] });
  }

  if (req.method === 'POST') {
    return parseBody(req).then(body => {
      const file = body.file === 'local' ? 'allowlist.local.json' : 'allowlist.json';
      const data = readJSON(file) || { allow: [] };
      data.allow = data.allow || [];
      if (!body.match) return send(res, 400, { error: 'match is required' });
      data.allow.push({
        match: body.match,
        pathGlob: body.pathGlob || '**',
        action: body.action || 'allow',
        reason: body.reason || ''
      });
      writeJSON(file, data);
      return send(res, 200, { ok: true });
    }).catch(e => send(res, 400, { error: e.message }));
  }

  if (req.method === 'DELETE') {
    return parseBody(req).then(body => {
      const file = body.file === 'local' ? 'allowlist.local.json' : 'allowlist.json';
      const data = readJSON(file) || { allow: [] };
      data.allow = (data.allow || []).filter(a => a.match !== body.match);
      writeJSON(file, data);
      return send(res, 200, { ok: true });
    }).catch(e => send(res, 400, { error: e.message }));
  }

  return send(res, 405, { error: 'Method not allowed' });
}

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

export function startServer(port = 7307) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);

    if (url.pathname === '/' || url.pathname === '/index.html') {
      const html = readFileSync(UI_PATH, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(html);
    }

    if (url.pathname === '/api/ngwords') return handleNgwords(req, res);
    if (url.pathname === '/api/whitelist') return handleWhitelist(req, res);
    if (url.pathname === '/api/allowlist') return handleAllowlist(req, res);

    res.writeHead(404);
    res.end('Not Found');
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`neko-not-yoshi UI: http://localhost:${port}`);
  });

  return server;
}
