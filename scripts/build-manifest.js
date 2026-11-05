'use strict';
// Membuat app/assets/manifest.json dari katalog di supabase/*.sql (urutan sama seperti saat dijalankan di Supabase).
// Tiap baris diberi "local": true bila file-nya ada di app/assets/. Jalankan ulang setelah menambah file aset.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const order = ['isi-katalog', 'migrasi-tambahan', 'migrasi-duo', 'migrasi-stiker', 'migrasi-template-baru', 'migrasi-template-baru1'];
const rx = /\('(\w+)','((?:[^']|'')*)','((?:[^']|'')*)','((?:[^']|'')*)','(\{.*?\})'::jsonb,(\d+)\)/g;
const un = (s) => s.replace(/''/g, "'");
const rows = new Map();

for (const f of order) {
  const file = path.join(root, 'supabase', f + '.sql');
  if (!fs.existsSync(file)) { console.warn('lewati (tidak ada):', f); continue; }
  const txt = fs.readFileSync(file, 'utf8');
  for (const m of txt.matchAll(rx)) {
    const row = { kind: m[1], key: un(m[2]), name: un(m[3]), path: m[4], meta: JSON.parse(m[5]), sort: Number(m[6]), active: true };
    rows.set(row.kind + '/' + row.key, row); // upsert: baris baru menimpa yang lama, urutan tetap
  }
}
const out = [...rows.values()].map((r) => ({ ...r, local: fs.existsSync(path.join(root, 'app', 'assets', r.path)) }));
out.sort((a, b) => a.sort - b.sort); // stabil: urutan sisipan dipertahankan untuk sort yang sama
fs.writeFileSync(path.join(root, 'app', 'assets', 'manifest.json'), JSON.stringify(out));
const miss = out.filter((r) => !r.local);
console.log(`manifest aset: ${out.length} baris, ${out.length - miss.length} ada di app/assets, ${miss.length} belum ada (diambil dari Supabase saat online).`);
if (miss.length) console.log('contoh yang belum ada:', miss.slice(0, 5).map((r) => r.path).join(', '));
