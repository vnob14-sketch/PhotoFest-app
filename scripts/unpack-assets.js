'use strict';
// Mengekstrak assets.zip (template + stiker) ke app/assets. Memakai tar (Windows 10+/macOS) atau unzip / PowerShell.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const zip = path.join(root, 'assets.zip');
const dest = path.join(root, 'app', 'assets');
if (!fs.existsSync(zip)) { console.log('assets.zip tidak ada, dilewati'); process.exit(0); }
if (fs.existsSync(path.join(dest, 'templates')) && fs.existsSync(path.join(dest, 'stickers'))) { console.log('aset sudah terekstrak'); process.exit(0); }
fs.mkdirSync(dest, { recursive: true });
const tries = [
  ['tar', ['-xf', zip, '-C', dest]],
  ['unzip', ['-oq', zip, '-d', dest]],
  ['powershell', ['-NoProfile', '-Command', `Expand-Archive -Force -LiteralPath '${zip}' -DestinationPath '${dest}'`]],
];
for (const [cmd, args] of tries) {
  const r = spawnSync(cmd, args, { stdio: 'ignore' });
  if (r.status === 0 && fs.existsSync(path.join(dest, 'templates'))) { console.log('aset diekstrak dengan', cmd); process.exit(0); }
}
console.error('Gagal mengekstrak assets.zip. Ekstrak manual: isi zip (templates, stickers) ke app/assets/');
process.exit(1);
