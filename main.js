'use strict';
const { app, BrowserWindow, Menu, protocol, session, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { createStore, ID_RE } = require('./lib/store');
const { createDrive } = require('./lib/gdrive');
const { createDslr } = require('./lib/dslr');
const printing = require('./lib/printing');

const APP_DIR = path.join(__dirname, 'app');
const ORIGIN = 'pfapp://pf/';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
};

protocol.registerSchemesAsPrivileged([{ scheme: 'pfapp', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

if (!app.requestSingleInstanceLock()) { app.quit(); }
app.setAppUserModelId('app.thefest.photofest');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let win = null, store, drive, dslr;

const clamp = (v, a, b, d) => { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d; };
const send = (ch, d) => { if (win && !win.isDestroyed()) win.webContents.send(ch, d); };

// ---------- pengaturan yang boleh diubah dari tampilan ----------
function view() {
  const s = store.get(), g = s.gdrive;
  return { ...s, gdrive: { enabled: g.enabled, clientId: g.clientId, hasSecret: !!g.clientSecretEnc, connected: !!g.refreshTokenEnc, email: g.email } };
}
function sanitize(p) {
  const o = {}, s = store.get();
  if (['local', 'online'].includes(p.account)) o.account = p.account;
  if ('retentionDays' in p) o.retentionDays = clamp(p.retentionDays, 0, 3650, 0);
  if ('maxSessions' in p) o.maxSessions = clamp(p.maxSessions, 0, 100000, 0);
  if (typeof p.fullscreen === 'boolean') o.fullscreen = p.fullscreen;
  if (p.printer && typeof p.printer === 'object') {
    const q = p.printer, r = {};
    if (typeof q.name === 'string') r.name = q.name.slice(0, 200);
    if (['strip', '4r', 'a4'].includes(q.paper)) r.paper = q.paper;
    if ('copies' in q) r.copies = clamp(q.copies, 1, 99, 1);
    if (typeof q.silent === 'boolean') r.silent = q.silent;
    if ('stripW' in q) r.stripW = clamp(q.stripW, 10, 1000, s.printer.stripW);
    if ('stripH' in q) r.stripH = clamp(q.stripH, 10, 1000, s.printer.stripH);
    o.printer = r;
  }
  if (p.camera && typeof p.camera.saved === 'object' && p.camera.saved && JSON.stringify(p.camera.saved).length < 2e5) o.camera = { saved: p.camera.saved };
  if (p.dslr && typeof p.dslr === 'object') {
    const r = {};
    if (typeof p.dslr.host === 'string' && /^[A-Za-z0-9.-]{1,100}$/.test(p.dslr.host)) r.host = p.dslr.host;
    if ('port' in p.dslr) r.port = clamp(p.dslr.port, 1, 65535, 5513);
    o.dslr = r;
  }
  if (p.gdrive && typeof p.gdrive === 'object') {
    const r = {};
    if (typeof p.gdrive.clientId === 'string') r.clientId = p.gdrive.clientId.trim().slice(0, 300);
    if (typeof p.gdrive.enabled === 'boolean') r.enabled = p.gdrive.enabled && !!s.gdrive.refreshTokenEnc;
    o.gdrive = r;
  }
  return o;
}

// ---------- protokol pfapp:// (aplikasi + file sesi) ----------
function registerProtocol() {
  protocol.handle('pfapp', async (req) => {
    const u = new URL(req.url);
    const notFound = () => new Response('Tidak ditemukan', { status: 404 });
    if (u.host !== 'pf') return notFound();
    const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    try {
      if (parts[0] === 'app') {
        const abs = path.join(APP_DIR, ...(parts.slice(1).length ? parts.slice(1) : ['photofest.html']));
        if (!abs.startsWith(APP_DIR + path.sep)) return notFound();
        const buf = await fsp.readFile(abs);
        return new Response(buf, { headers: { 'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream' } });
      }
      if (parts[0] === 'take' && parts.length === 3) {
        const f = await store.fileOf(parts[1], parts[2]);
        if (!f) return notFound();
        const headers = { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' };
        const dl = u.searchParams.get('dl');
        if (dl) headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(dl.replace(/[\\/:*?"<>|]/g, '_'))}`;
        return new Response(await fsp.readFile(f), { headers });
      }
    } catch { /* jatuh ke 404 */ }
    return notFound();
  });
}

// ---------- IPC ----------
const trusted = (e) => !!(e.senderFrame && String(e.senderFrame.url).startsWith(ORIGIN));
const H = (ch, fn) => ipcMain.handle(ch, (e, ...a) => { if (!trusted(e)) throw new Error('ditolak'); return fn(e, ...a); });
const MAXFILE = 80 * 1024 * 1024;

function setupIpc() {
  ipcMain.on('pf:settings:sync', (e) => { e.returnValue = trusted(e) ? view() : {}; });
  H('pf:settings:patch', (_e, p) => {
    const before = store.get().fullscreen;
    store.patch(sanitize(p || {}));
    if (store.get().fullscreen !== before && win) win.setFullScreen(store.get().fullscreen);
    return view();
  });
  H('pf:app:info', () => ({ version: app.getVersion(), electron: process.versions.electron, platform: process.platform, userData: app.getPath('userData') }));
  H('pf:app:fullscreen', (_e, on) => { if (win) win.setFullScreen(!!on); store.patch({ fullscreen: !!on }); return !!on; });

  H('pf:storage:info', () => store.info());
  H('pf:storage:pick', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Pilih folder penyimpanan PhotoFest', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    store.patch({ storage: { mode: 'folder', folder: r.filePaths[0] } });
    return store.info();
  });
  H('pf:storage:use', async (_e, mode, folder) => {
    if (mode === 'internal') store.patch({ storage: { mode: 'internal', folder: '' } });
    else {
      if (typeof folder !== 'string' || !(await fsp.stat(folder).then((s) => s.isDirectory(), () => false))) throw new Error('Folder tidak ditemukan');
      store.patch({ storage: { mode: 'folder', folder } });
    }
    return store.info();
  });
  H('pf:storage:clouds', () => store.detectClouds());
  H('pf:storage:test', () => store.testWrite());
  H('pf:storage:open', async () => { await fsp.mkdir(store.rootDir(), { recursive: true }); return shell.openPath(store.rootDir()); });

  H('pf:take:begin', () => store.begin());
  H('pf:take:put', (_e, id, name, data) => {
    const buf = Buffer.from(data);
    if (buf.length > MAXFILE) throw new Error('File terlalu besar');
    return store.put(id, name, buf);
  });
  H('pf:take:finish', (_e, id, names) => store.finish(id, Array.isArray(names) ? names.map(String) : []));
  H('pf:take:list', async () => (await store.list()).map((m) => ({ id: m.id, seq: m.seq, created_at: m.created_at, expires_at: m.expires_at, files: m.files })));
  H('pf:take:remove', (_e, id) => store.remove(id));
  H('pf:take:quota', () => store.quota());

  H('pf:gdrive:status', () => drive.status());
  H('pf:gdrive:connect', (_e, c) => drive.connect(c || {}));
  H('pf:gdrive:disconnect', () => drive.disconnect());

  const ctx = () => ({ BrowserWindow, tmpDir: path.join(app.getPath('temp'), 'photofest-print') });
  H('pf:print:list', (e) => printing.listPrinters(e.sender));
  H('pf:print:sheet', (_e, o) => {
    const s = store.get().printer;
    return printing.printSheet(ctx(), {
      dataUrl: o.dataUrl, paper: ['strip', '4r', 'a4'].includes(o.paper) ? o.paper : s.paper, n: o.n === 2 ? 2 : 1,
      printer: typeof o.printer === 'string' ? o.printer : s.name, copies: o.copies || s.copies,
      silent: typeof o.silent === 'boolean' ? o.silent : s.silent, settings: s,
    });
  });
  H('pf:print:test', (_e, o = {}) => {
    const s = store.get().printer;
    return printing.printTest(ctx(), {
      paper: ['strip', '4r', 'a4'].includes(o.paper) ? o.paper : s.paper, printer: typeof o.printer === 'string' ? o.printer : s.name,
      copies: 1, silent: typeof o.silent === 'boolean' ? o.silent : s.silent, settings: s,
    });
  });

  H('pf:dslr:status', () => dslr.status());
  H('pf:dslr:options', async () => ({ props: dslr.PROPS, options: await dslr.allOptions() }));
  H('pf:dslr:set', (_e, k, v) => dslr.set(String(k), String(v)));
  H('pf:dslr:liveStart', () => dslr.liveStart());
  H('pf:dslr:liveStop', () => dslr.liveStop());
  H('pf:dslr:frame', () => dslr.frame());
  H('pf:dslr:capture', () => dslr.capture(path.join(app.getPath('temp'), 'photofest-dslr')));
}

// ---------- jendela + menu ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 620, backgroundColor: '#fbf3e6', title: 'PhotoFest',
    icon: path.join(__dirname, 'build', 'icon.ico'), autoHideMenuBar: true, fullscreen: !!store.get().fullscreen,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  win.loadURL(ORIGIN + 'app/photofest.html');
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^(https?|mailto):/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(ORIGIN)) return;
    e.preventDefault();
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
  });
  win.on('closed', () => { win = null; });
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'PhotoFest', submenu: [
      { label: 'Pengaturan…', accelerator: 'CmdOrCtrl+,', click: () => send('pf:open-settings') },
      { label: 'Buka folder foto', click: () => shell.openPath(store.rootDir()) },
      { type: 'separator' }, { role: 'quit', label: 'Keluar' },
    ] },
    { label: 'Tampilan', submenu: [
      { label: 'Layar penuh', accelerator: 'F11', click: () => { if (win) { const v = !win.isFullScreen(); win.setFullScreen(v); store.patch({ fullscreen: v }); } } },
      { role: 'reload', label: 'Muat ulang' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { role: 'toggleDevTools', label: 'Alat pengembang' },
    ] },
  ]));
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(() => {
  const userData = app.getPath('userData');
  store = createStore({ userData, pictures: app.getPath('pictures'), onFile: (rel) => drive && drive.enqueue(rel) });
  drive = createDrive({ store, userData, safeStorage, openExternal: (u) => shell.openExternal(u), onStatus: (s) => send('pf:gdrive', s) });
  dslr = createDslr(() => store.get().dslr);

  // kamera dan mikrofon hanya untuk halaman aplikasi sendiri
  const own = (wc, url) => String(url || (wc && wc.getURL()) || '').startsWith('pfapp://pf');
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, d) => cb(own(wc, d && d.requestingUrl) && ['media', 'fullscreen', 'clipboard-sanitized-write'].includes(perm)));
  session.defaultSession.setPermissionCheckHandler((wc, perm, origin) => own(wc, origin) && ['media', 'fullscreen', 'clipboard-sanitized-write'].includes(perm));
  session.defaultSession.on('will-download', (_e, item) => {
    const dir = app.getPath('downloads');
    const ext = path.extname(item.getFilename()), stem = path.basename(item.getFilename(), ext).replace(/[\\/:*?"<>|]/g, '_') || 'PhotoFest';
    let f = path.join(dir, stem + ext), i = 1;
    while (fs.existsSync(f)) f = path.join(dir, `${stem} (${i++})${ext}`);
    item.setSavePath(f);
    item.once('done', (_ev, st) => { if (st === 'completed') send('pf:downloaded', { path: f, name: path.basename(f) }); });
  });

  registerProtocol();
  setupIpc();
  buildMenu();
  createWindow();
  store.cleanup().catch(() => {});
  setInterval(() => store.cleanup().catch(() => {}), 3600e3).unref();
  drive.start();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => app.quit());
