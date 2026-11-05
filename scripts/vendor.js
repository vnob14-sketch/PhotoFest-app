'use strict';
// Menyalin library browser dari node_modules ke app/vendor supaya aplikasi bisa jalan tanpa CDN.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const files = [
  ['node_modules/@supabase/supabase-js/dist/umd/supabase.js', 'app/vendor/supabase.min.js'],
  ['node_modules/peerjs/dist/peerjs.min.js', 'app/vendor/peerjs.min.js'],
];
fs.mkdirSync(path.join(root, 'app', 'vendor'), { recursive: true });
for (const [from, to] of files) {
  const src = path.join(root, from);
  if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(root, to)); console.log('vendor:', to); }
  else console.warn('vendor dilewati (belum ada, akan memakai CDN):', from);
}
