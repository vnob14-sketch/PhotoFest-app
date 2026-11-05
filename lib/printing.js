'use strict';
// Cetak lewat driver Windows. Semua printer yang terpasang (USB, jaringan, PDF, dye-sub) terdaftar.
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const mm = (v) => Math.max(10, Math.min(1000, Number(v) || 0));

async function listPrinters(wc) {
  const a = await wc.getPrintersAsync();
  return a.map((p) => ({ name: p.name, displayName: p.displayName || p.name, description: p.description || '', status: p.status, isDefault: !!p.isDefault }));
}

// Ukuran kertas (mm) untuk tiap preset di dialog Print view
function pageFor(paper, s) {
  if (paper === '4r') return { w: 102, h: 152, css: '102mm 152mm' };
  if (paper === 'a4') return { w: 210, h: 297, css: 'A4' };
  const w = mm(s.stripW || 50), h = mm(s.stripH || 150);
  return { w, h, css: `${w}mm ${h}mm` };
}

async function printHtml({ BrowserWindow, tmpDir, html, page, printer, copies, silent }) {
  await fsp.mkdir(tmpDir, { recursive: true });
  const id = crypto.randomBytes(6).toString('hex');
  const file = path.join(tmpDir, `cetak-${id}.html`);
  await fsp.writeFile(file, html);
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, javascript: true } });
  try {
    await win.loadFile(file);
    await win.webContents.executeJavaScript('Promise.all([...document.images].map(i=>i.decode().catch(()=>0)))');
    await new Promise((resolve, reject) => {
      win.webContents.print({
        silent: !!silent,
        deviceName: printer || undefined,
        printBackground: true,
        color: true,
        landscape: false,
        copies: Math.max(1, Math.min(99, Number(copies) || 1)),
        margins: { marginType: 'none' },
        pageSize: page.css === 'A4' ? 'A4' : { width: Math.round(page.w * 1000), height: Math.round(page.h * 1000) },
      }, (ok, why) => (ok ? resolve() : reject(new Error(why || 'Pencetakan dibatalkan atau gagal'))));
    });
    return true;
  } finally {
    if (!win.isDestroyed()) win.destroy();
    fsp.rm(file, { force: true }).catch(() => {});
  }
}

const css = (page) => `@page{size:${page.css};margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;width:${page.w}mm;height:${page.h}mm;overflow:hidden;background:#fff}`;

async function printSheet(ctx, { dataUrl, paper, n, printer, copies, silent, settings }) {
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('Gambar cetak tidak valid');
  const page = pageFor(paper, settings);
  const imgs = (n === 2 ? [0, 1] : [0]).map(() => `<img src="${dataUrl}">`).join('');
  const html = `<!doctype html><meta charset="utf-8"><style>${css(page)}
.sheet{width:100%;height:100%;display:flex;justify-content:center;align-items:center;gap:3%;padding:${paper === 'strip' ? 0 : '4mm'}}
.sheet img{max-width:100%;max-height:100%;display:block;object-fit:contain}.two img{max-width:48%}</style>
<div class="sheet ${n === 2 ? 'two' : ''}">${imgs}</div>`;
  return printHtml({ ...ctx, html, page, printer, copies, silent });
}

async function printTest(ctx, { paper, printer, copies, silent, settings }) {
  const page = pageFor(paper, settings);
  const html = `<!doctype html><meta charset="utf-8"><style>${css(page)}
body{font:700 3.2mm/1.4 Arial,sans-serif;color:#2a0409}
.f{position:absolute;inset:1mm;border:.4mm solid #8c0f22}
.g{position:absolute;inset:1mm;background:repeating-linear-gradient(0deg,transparent 0 9.9mm,#ddd 9.9mm 10mm),repeating-linear-gradient(90deg,transparent 0 9.9mm,#ddd 9.9mm 10mm)}
.t{position:absolute;left:4mm;top:4mm;right:4mm}.t b{font-size:5mm;color:#8c0f22}</style>
<div class="g"></div><div class="f"></div>
<div class="t"><b>PhotoFest</b><br>Halaman tes cetak<br>Ukuran: ${page.w} x ${page.h} mm<br>Kotak abu-abu = 10 x 10 mm<br>Bingkai merah harus utuh di keempat sisi.</div>`;
  return printHtml({ ...ctx, html, page, printer, copies, silent });
}

module.exports = { listPrinters, printSheet, printTest, pageFor };
