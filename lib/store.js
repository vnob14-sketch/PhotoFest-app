'use strict';
// Pengaturan + penyimpanan sesi PhotoFest di disk.
// Struktur folder (sama untuk internal, folder pilihan, folder cloud, dan Google Drive API):
//   <root>/PhotoFest/print/     foto siap print     (PF_<waktu>_<id>_print.jpg)
//   <root>/PhotoFest/animated/  GIF strip + GIF asli
//   <root>/PhotoFest/original/  foto mentah dari kamera
//   <root>/PhotoFest/_data/<id>/ data edit (state.json, clips.jpg) + meta.json
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const DEFAULTS = {
  storage: { mode: 'internal', folder: '' }, // internal | folder (folder cloud juga masuk "folder")
  gdrive: { enabled: false, clientId: '', clientSecretEnc: '', refreshTokenEnc: '', email: '' },
  account: 'local', // local = tanpa akun (kios) | online = akun Supabase
  retentionDays: 0, // 0 = tidak dihapus otomatis
  maxSessions: 0, // 0 = tanpa batas
  printer: { name: '', paper: 'strip', copies: 1, silent: true, stripW: 50, stripH: 150 },
  camera: { saved: {} },
  dslr: { host: '127.0.0.1', port: 5513 },
  fullscreen: false,
};

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const merge = (a, b) => {
  const o = { ...a };
  for (const k of Object.keys(b || {})) o[k] = isObj(b[k]) && isObj(a[k]) && k !== 'saved' ? merge(a[k], b[k]) : b[k];
  return o;
};
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const kindOf = (n) => (n === 'print.jpg' ? 'print' : /\.gif$/i.test(n) ? 'animated' : /^raw\d\.jpg$/i.test(n) ? 'original' : '_data');
const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

function createStore({ userData, pictures, onChange, onFile }) {
  const file = path.join(userData, 'settings.json');
  let S = merge(DEFAULTS, readJson(file, {}));

  const save = () => {
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(S, null, 2));
    fs.renameSync(file + '.tmp', file);
  };
  const get = () => S;
  const patch = (p) => { S = merge(S, p); save(); if (onChange) onChange(S); return S; };

  // ---------- lokasi ----------
  const baseDir = () => (S.storage.mode === 'folder' && S.storage.folder ? S.storage.folder : pictures);
  const rootDir = () => {
    const b = baseDir();
    return path.basename(b).toLowerCase() === 'photofest' ? b : path.join(b, 'PhotoFest');
  };
  const inRoot = (abs) => {
    const r = path.resolve(rootDir()) + path.sep;
    const a = path.resolve(abs);
    return a.startsWith(r);
  };
  const metaPath = (id) => path.join(rootDir(), '_data', id, 'meta.json');
  const relOf = (meta, name) => {
    const k = kindOf(name);
    return k === '_data' ? `_data/${meta.id}/${name}` : `${k}/${meta.base}_${name}`;
  };
  const absOf = (rel) => path.join(rootDir(), ...rel.split('/'));

  async function writeAtomic(abs, buf) {
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    const t = abs + '.part';
    await fsp.writeFile(t, buf);
    await fsp.rename(t, abs);
  }
  const readMeta = async (id) => {
    if (!ID_RE.test(id)) throw new Error('id sesi tidak valid');
    try { return JSON.parse(await fsp.readFile(metaPath(id), 'utf8')); } catch { return null; }
  };
  const writeMeta = (m) => writeAtomic(metaPath(m.id), JSON.stringify(m, null, 2));

  async function nextSeq() {
    const f = path.join(rootDir(), '_data', 'counter.json');
    let n = 0;
    try { n = JSON.parse(await fsp.readFile(f, 'utf8')).n || 0; } catch {}
    if (!n) { for (const t of await allMeta()) n = Math.max(n, t.seq || 0); }
    n += 1;
    await writeAtomic(f, JSON.stringify({ n }));
    return n;
  }
  async function allMeta() {
    const dir = path.join(rootDir(), '_data');
    let names = [];
    try { names = await fsp.readdir(dir); } catch { return []; }
    const out = [];
    for (const n of names) {
      if (!ID_RE.test(n)) continue;
      const m = await readMeta(n);
      if (m) out.push(m);
    }
    return out;
  }

  // Operasi pada satu sesi dijalankan berurutan (upload paralel tidak boleh saling menimpa meta.json)
  const chains = new Map();
  const lock = (id, fn) => {
    const prev = chains.get(id) || Promise.resolve();
    const next = prev.then(fn, fn);
    chains.set(id, next.catch(() => {}));
    return next;
  };

  // ---------- sesi ----------
  async function list() {
    const a = (await allMeta()).filter((m) => m.status === 'ready');
    a.sort((x, y) => (x.created_at < y.created_at ? 1 : -1));
    return a;
  }
  async function quota() {
    return { gmax: S.maxSessions > 0 ? S.maxSessions : null, gcount: (await list()).length };
  }
  async function begin() {
    if (S.maxSessions > 0 && (await list()).length >= S.maxSessions) throw new Error('gallery_full');
    const id = crypto.randomUUID();
    const now = new Date();
    const m = {
      id, seq: await nextSeq(), base: `PF_${stamp(now)}_${id.slice(0, 8)}`,
      created_at: now.toISOString(),
      expires_at: S.retentionDays > 0 ? new Date(now.getTime() + S.retentionDays * 864e5).toISOString() : null,
      status: 'pending', files: [],
    };
    await writeMeta(m);
    return id;
  }
  const put = (id, name, buf, opts) => lock(id, () => putNow(id, name, buf, opts || {}));
  async function putNow(id, name, buf, opts) {
    if (!NAME_RE.test(name)) throw new Error('nama file tidak valid');
    let m = await readMeta(id);
    if (!m) { // sesi dari server online (mirror) belum punya meta lokal
      const now = new Date();
      m = { id, seq: 0, base: `PF_${stamp(now)}_${id.slice(0, 8)}`, created_at: now.toISOString(), expires_at: null, status: 'mirror', files: [] };
    }
    const rel = relOf(m, name);
    await writeAtomic(absOf(rel), Buffer.from(buf));
    if (!m.files.includes(name)) m.files.push(name);
    await writeMeta(m);
    if (onFile && !opts.silent) onFile(rel);
    return rel;
  }
  const finish = (id, names) => lock(id, () => finishNow(id, names));
  async function finishNow(id, names) {
    const m = await readMeta(id);
    if (!m) throw new Error('sesi tidak ditemukan');
    for (const n of names || []) if (NAME_RE.test(n) && !m.files.includes(n)) m.files.push(n);
    m.status = 'ready';
    await writeMeta(m);
    return true;
  }
  const remove = (id) => lock(id, () => removeNow(id));
  async function removeNow(id) {
    const m = await readMeta(id);
    if (!m) return false;
    for (const n of m.files) { try { await fsp.unlink(absOf(relOf(m, n))); } catch {} }
    await fsp.rm(path.join(rootDir(), '_data', id), { recursive: true, force: true });
    return true;
  }
  async function fileOf(id, name) {
    if (!NAME_RE.test(name)) return null;
    const m = await readMeta(id);
    if (!m || !m.files.includes(name)) return null;
    const abs = absOf(relOf(m, name));
    return inRoot(abs) ? abs : null;
  }
  async function cleanup() {
    let n = 0;
    const now = Date.now();
    for (const m of await allMeta()) {
      const old = m.status === 'pending' && now - new Date(m.created_at) > 864e5;
      const exp = m.status === 'ready' && m.expires_at && new Date(m.expires_at) < now;
      if (old || exp) { await remove(m.id); n++; }
    }
    return n;
  }

  // ---------- info + cloud ----------
  async function info() {
    const root = rootDir();
    let free = null;
    try { await fsp.mkdir(root, { recursive: true }); const s = await fsp.statfs(root); free = s.bavail * s.bsize; } catch {}
    return { root, mode: S.storage.mode, free, sessions: (await list()).length };
  }
  async function testWrite() {
    const f = path.join(rootDir(), '_data', `.tulis-tes-${process.pid}`);
    await writeAtomic(f, 'ok');
    await fsp.rm(f, { force: true });
    return true;
  }
  async function detectClouds(env = process.env) {
    const out = [];
    const cand = [];
    const add = (kind, label, p) => { if (p) cand.push({ kind, label, path: p }); };
    const home = os.homedir();
    for (const k of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) add('onedrive', 'OneDrive', env[k]);
    for (const b of [env.APPDATA, env.LOCALAPPDATA]) {
      if (!b) continue;
      const j = readJson(path.join(b, 'Dropbox', 'info.json'), {});
      for (const k of Object.keys(j)) if (j[k] && j[k].path) add('dropbox', 'Dropbox' + (k === 'business' ? ' (bisnis)' : ''), j[k].path);
    }
    for (const L of 'DEFGHIJKLMNOPQRSTUVWXYZ') for (const n of ['My Drive', 'Drive Saya']) add('gdrive', 'Google Drive', `${L}:\\${n}`);
    for (const n of ['Google Drive', 'My Drive', 'Drive Saya']) add('gdrive', 'Google Drive', path.join(home, n));
    [['icloud', 'iCloud Drive', 'iCloudDrive'], ['mega', 'MEGA', 'MEGA'], ['box', 'Box', 'Box'], ['pcloud', 'pCloud', 'pCloudDrive'], ['nextcloud', 'Nextcloud', 'Nextcloud'], ['sync', 'Sync.com', 'Sync']]
      .forEach(([k, l, d]) => add(k, l, path.join(home, d)));
    const seen = new Set();
    await Promise.all(cand.map(async (c) => {
      try { if ((await fsp.stat(c.path)).isDirectory()) { const key = c.path.toLowerCase(); if (!seen.has(key)) { seen.add(key); out.push(c); } } } catch {}
    }));
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }

  return { get, patch, rootDir, absOf, relOf, begin, put, finish, remove, list, quota, fileOf, cleanup, info, testWrite, detectClouds, readMeta };
}

module.exports = { createStore, DEFAULTS, ID_RE, NAME_RE, kindOf };
