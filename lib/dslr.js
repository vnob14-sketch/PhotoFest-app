'use strict';
// Kontrol kamera DSLR/mirrorless lewat digiCamControl (gratis, Windows).
// Aktifkan di digiCamControl: Settings > Webserver > "Use web server" (port bawaan 5513).
// API yang dipakai: /?slc=set|get|list|capture, /?CMD=LiveViewWnd_Show|Hide, /liveview.jpg
const fsp = require('fs/promises');
const path = require('path');

// Properti yang bisa diatur: nama di digiCamControl -> label tampilan
const PROPS = [
  ['iso', 'ISO'],
  ['aperture', 'Aperture (f)'],
  ['shutterspeed', 'Shutter speed'],
  ['whitebalance', 'White balance'],
  ['exposurecompensation', 'Exposure compensation'],
  ['compressionsetting', 'Kualitas / format file'],
  ['focusmode', 'Mode fokus'],
  ['mode', 'Mode eksposur (P/A/S/M)'],
];

function createDslr(getCfg) {
  const base = () => { const c = getCfg(); return `http://${c.host || '127.0.0.1'}:${c.port || 5513}`; };
  async function get(pathAndQuery, { timeout = 4000, binary = false } = {}) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(base() + pathAndQuery, { signal: ctl.signal });
      if (!r.ok) throw new Error('digiCamControl membalas ' + r.status);
      return binary ? Buffer.from(await r.arrayBuffer()) : (await r.text()).trim();
    } finally { clearTimeout(t); }
  }
  const slc = (cmd, p1 = '', p2 = '', opt) => get(`/?slc=${encodeURIComponent(cmd)}&param1=${encodeURIComponent(p1)}&param2=${encodeURIComponent(p2)}`, opt);

  // Format balasan "list" tidak terdokumentasi rinci: terima JSON atau teks dipisah baris/koma/titik koma.
  function parseList(t) {
    if (!t) return [];
    try {
      const j = JSON.parse(t);
      const a = Array.isArray(j) ? j : Object.values(j);
      return a.map((x) => (typeof x === 'object' && x ? x.Name || x.name || x.Value || x.value || JSON.stringify(x) : String(x))).filter(Boolean);
    } catch {}
    return t.split(/[\r\n|;,]+/).map((s) => s.trim()).filter((s) => s && s.toUpperCase() !== 'OK');
  }

  async function status() {
    try {
      const t = await slc('list', 'cameras', '', { timeout: 1500 });
      return { running: true, cameras: parseList(t) };
    } catch (e) {
      return { running: false, cameras: [], error: e.name === 'AbortError' ? 'Tidak ada respons' : 'Tidak terhubung' };
    }
  }
  async function options(prop) {
    try { return parseList(await slc('list', 'camera.' + prop)); } catch { return []; }
  }
  async function allOptions() {
    const out = {};
    await Promise.all(PROPS.map(async ([k]) => { out[k] = await options(k); }));
    return out;
  }
  async function set(prop, value) {
    if (!PROPS.some(([k]) => k === prop)) throw new Error('properti tidak dikenal');
    const r = await slc('set', prop, String(value));
    if (r && !/^ok/i.test(r)) throw new Error(r);
    return true;
  }
  const liveStart = () => get('/?CMD=LiveViewWnd_Show');
  const liveStop = () => get('/?CMD=LiveViewWnd_Hide');
  const frame = () => get('/liveview.jpg?t=' + Date.now(), { timeout: 2500, binary: true });

  // Jepret resolusi penuh. Mengembalikan Buffer JPEG.
  async function capture(tmpDir) {
    await fsp.mkdir(tmpDir, { recursive: true });
    await slc('set', 'session.folder', tmpDir);
    await slc('capture');
    const t0 = Date.now();
    while (Date.now() - t0 < 25000) {
      await new Promise((r) => setTimeout(r, 600));
      const n = await slc('get', 'lastcaptured');
      if (n && n !== '-' && !/error/i.test(n)) {
        const f = path.join(tmpDir, path.basename(n));
        try { return await fsp.readFile(f); } catch { return get('/image/' + encodeURIComponent(path.basename(n)), { binary: true, timeout: 15000 }); }
      }
    }
    throw new Error('Kamera tidak mengirim hasil jepretan (25 detik).');
  }

  return { PROPS, status, options, allOptions, set, liveStart, liveStop, frame, capture };
}

module.exports = { createDslr, PROPS };
