'use strict';
// Pemeriksaan sintaks cepat untuk semua file JS (dipakai di CI).
const { spawnSync } = require('child_process');
const path = require('path');
const root = path.join(__dirname, '..');
const files = ['main.js', 'preload.js', 'lib/store.js', 'lib/gdrive.js', 'lib/dslr.js', 'lib/printing.js', 'app/desktop.js', 'scripts/build-manifest.js', 'scripts/vendor.js', 'scripts/unpack-assets.js'];
let bad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', path.join(root, f)], { encoding: 'utf8' });
  if (r.status) { bad++; console.error(f + '\n' + r.stderr); }
}
if (bad) process.exit(1);
console.log('Sintaks OK (' + files.length + ' file)');
