// Upload semua aset + template ke Supabase. Jalankan dari folder proyek:
//   npm i @supabase/supabase-js
//   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... node tools/upload-assets.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const rows = JSON.parse(readFileSync('assets/manifest.json', 'utf8'));
let n = 0;
for (const r of rows) {
  const { error } = await sb.storage.from('assets').upload(r.path, readFileSync('assets/files/' + r.path), { upsert: true, contentType: 'image/webp', cacheControl: '31536000' });
  if (error) throw new Error(r.path + ': ' + error.message);
  if (++n % 20 === 0) console.log(n + '/' + rows.length);
}
const { error } = await sb.from('catalog').upsert(rows, { onConflict: 'kind,key' });
if (error) throw error;
console.log('Selesai:', rows.length, 'aset');
