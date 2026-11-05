'use strict';
// Upload otomatis ke Google Drive lewat API (opsional). Cakupan izin: drive.file, jadi aplikasi
// hanya bisa melihat file yang dibuatnya sendiri. Antrean disimpan di disk, jadi aman saat offline.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email';
const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.json': 'application/json' };

function createDrive({ store, userData, safeStorage, openExternal, onStatus }) {
  const qFile = path.join(userData, 'gdrive-queue.json');
  const mFile = path.join(userData, 'gdrive-map.json');
  const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
  let queue = readJ(qFile, []);
  let map = readJ(mFile, {});
  let busy = false, timer = null, delay = 15000, lastError = '', token = null, connecting = false;

  const saveQ = () => fs.writeFileSync(qFile, JSON.stringify(queue));
  const saveM = () => fs.writeFileSync(mFile, JSON.stringify(map));
  const seal = (s) => (s ? (safeStorage && safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(s).toString('base64') : 'raw:' + Buffer.from(s).toString('base64')) : '');
  const unseal = (s) => {
    if (!s) return '';
    const [k, v] = [s.slice(0, 4), s.slice(4)];
    try { return k === 'enc:' ? safeStorage.decryptString(Buffer.from(v, 'base64')) : Buffer.from(v, 'base64').toString(); } catch { return ''; }
  };
  const cfg = () => store.get().gdrive;
  const connected = () => !!cfg().refreshTokenEnc;
  const status = () => ({ enabled: cfg().enabled, connected: connected(), email: cfg().email, pending: queue.length, error: lastError, connecting });
  const notify = () => onStatus && onStatus(status());

  async function form(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error_description || j.error || 'http ' + r.status); e.code = j.error; throw e; }
    return j;
  }
  async function accessToken() {
    if (token && token.exp > Date.now() + 60000) return token.v;
    const c = cfg();
    const j = await form('https://oauth2.googleapis.com/token', {
      client_id: c.clientId, client_secret: unseal(c.clientSecretEnc), refresh_token: unseal(c.refreshTokenEnc), grant_type: 'refresh_token',
    });
    token = { v: j.access_token, exp: Date.now() + (j.expires_in || 3000) * 1000 };
    return token.v;
  }

  // ---------- masuk Google (loopback + PKCE) ----------
  async function connect({ clientId, clientSecret }) {
    clientId = String(clientId || '').trim();
    clientSecret = String(clientSecret || '').trim() || unseal(cfg().clientSecretEnc);
    if (!clientId || !clientSecret) throw new Error('Isi Client ID dan Client Secret dulu.');
    if (connecting) throw new Error('Proses masuk masih berjalan.');
    connecting = true; notify();
    const verifier = b64u(crypto.randomBytes(48));
    const state = b64u(crypto.randomBytes(16));
    let server;
    try {
      const code = await new Promise((resolve, reject) => {
        server = http.createServer((req, res) => {
          const u = new URL(req.url, 'http://127.0.0.1');
          if (u.pathname !== '/cb') { res.writeHead(404); return res.end(); }
          const ok = u.searchParams.get('state') === state && u.searchParams.get('code');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<meta charset="utf-8"><body style="font:16px sans-serif;padding:40px"><h2>${ok ? 'Berhasil terhubung' : 'Gagal'}</h2><p>${ok ? 'Kembali ke PhotoFest. Tab ini boleh ditutup.' : 'Coba lagi dari PhotoFest.'}</p>`);
          ok ? resolve(u.searchParams.get('code')) : reject(new Error(u.searchParams.get('error') || 'Login dibatalkan'));
        });
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
          const redirect = `http://127.0.0.1:${server.address().port}/cb`;
          server.redirect = redirect;
          const q = new URLSearchParams({
            client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: SCOPES, state,
            code_challenge: b64u(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
            access_type: 'offline', prompt: 'consent',
          });
          openExternal('https://accounts.google.com/o/oauth2/v2/auth?' + q);
        });
        setTimeout(() => reject(new Error('Waktu habis. Coba hubungkan lagi.')), 180000);
      });
      const j = await form('https://oauth2.googleapis.com/token', {
        client_id: clientId, client_secret: clientSecret, code, code_verifier: verifier, redirect_uri: server.redirect, grant_type: 'authorization_code',
      });
      if (!j.refresh_token) throw new Error('Google tidak memberi izin akses offline. Coba hubungkan lagi.');
      token = { v: j.access_token, exp: Date.now() + (j.expires_in || 3000) * 1000 };
      let email = '';
      try { email = (await (await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + token.v } })).json()).email || ''; } catch {}
      store.patch({ gdrive: { enabled: true, clientId, clientSecretEnc: seal(clientSecret), refreshTokenEnc: seal(j.refresh_token), email } });
      lastError = '';
      kick();
      return status();
    } finally {
      connecting = false;
      if (server) server.close();
      notify();
    }
  }
  function disconnect() {
    token = null; lastError = '';
    store.patch({ gdrive: { enabled: false, refreshTokenEnc: '', clientSecretEnc: '', email: '' } });
    notify();
    return status();
  }

  // ---------- folder + upload ----------
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  async function api(url, opt = {}) {
    const r = await fetch(url, { ...opt, headers: { Authorization: 'Bearer ' + (await accessToken()), ...(opt.headers || {}) } });
    if (r.status === 401) token = null;
    const t = await r.text();
    let j = {}; try { j = JSON.parse(t); } catch {}
    if (!r.ok) { const e = new Error((j.error && (j.error.message || j.error)) || 'http ' + r.status); e.status = r.status; throw e; }
    return j;
  }
  async function folderId(parts) {
    let parent = 'root', key = '';
    for (const p of parts) {
      key += '/' + p;
      if (map['__dir' + key]) { parent = map['__dir' + key]; continue; }
      const q = `name='${esc(p)}' and mimeType='application/vnd.google-apps.folder' and '${parent}' in parents and trashed=false`;
      const f = await api('https://www.googleapis.com/drive/v3/files?fields=files(id)&pageSize=1&q=' + encodeURIComponent(q));
      let id = f.files && f.files[0] && f.files[0].id;
      if (!id) {
        const c = await api('https://www.googleapis.com/drive/v3/files?fields=id', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: p, mimeType: 'application/vnd.google-apps.folder', parents: [parent] }),
        });
        id = c.id;
      }
      map['__dir' + key] = id; saveM(); parent = id;
    }
    return parent;
  }
  async function send(rel) {
    const abs = store.absOf(rel);
    let buf;
    try { buf = await fsp.readFile(abs); } catch { return; } // file sudah dihapus: lewati
    const parts = rel.split('/');
    const name = parts.pop();
    const mime = MIME[path.extname(name).toLowerCase()] || 'application/octet-stream';
    const known = map[rel];
    const build = (meta) => {
      const b = 'pf' + crypto.randomBytes(12).toString('hex');
      return { b, body: Buffer.concat([Buffer.from(`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${mime}\r\n\r\n`), buf, Buffer.from(`\r\n--${b}--`)]) };
    };
    const post = async (url, method, meta) => {
      const { b, body } = build(meta);
      return api(url, { method, headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body });
    };
    if (known) {
      try { await post(`https://www.googleapis.com/upload/drive/v3/files/${known}?uploadType=multipart&fields=id`, 'PATCH', { name }); return; }
      catch (e) { if (e.status !== 404) throw e; delete map[rel]; }
    }
    const dir = await folderId(['PhotoFest', ...parts]);
    const j = await post('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', 'POST', { name, parents: [dir] });
    map[rel] = j.id; saveM();
  }

  async function run() {
    if (busy || !cfg().enabled || !connected()) return;
    busy = true;
    try {
      while (queue.length) {
        await send(queue[0]);
        queue.shift(); saveQ(); lastError = ''; delay = 15000; notify();
      }
    } catch (e) {
      lastError = e.code === 'invalid_grant' ? 'Akses Google dicabut. Hubungkan ulang.' : String(e.message || e);
      if (e.code === 'invalid_grant') { store.patch({ gdrive: { refreshTokenEnc: '' } }); }
      else { clearTimeout(timer); timer = setTimeout(kick, delay); delay = Math.min(delay * 2, 300000); }
      notify();
    } finally { busy = false; }
  }
  function kick() { run(); }
  function enqueue(rel) {
    if (!cfg().enabled || !connected()) return;
    if (!queue.includes(rel)) { queue.push(rel); saveQ(); notify(); }
    kick();
  }
  function start() { if (queue.length) kick(); }

  return { status, connect, disconnect, enqueue, start };
}

module.exports = { createDrive };
