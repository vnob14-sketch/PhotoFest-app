// Dipanggil terjadwal (tiap jam). Hapus file + baris take yang umurnya sudah 7 hari sejak difoto.
import { createClient } from 'npm:@supabase/supabase-js@2';
Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return new Response('forbidden', { status: 401 });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const names = ['print.jpg', 'strip.gif', 'orig.gif', 'state.json', 'clips.jpg', 'raw0.jpg', 'raw1.jpg', 'raw2.jpg', 'raw3.jpg'];
  let total = 0;
  for (;;) {
    const { data } = await admin.from('takes').select('id,user_id').lt('expires_at', new Date().toISOString()).limit(200);
    if (!data?.length) break;
    const { error } = await admin.storage.from('takes').remove(data.flatMap((t) => names.map((n) => `${t.user_id}/${t.id}/${n}`)));
    if (error) return new Response(error.message, { status: 500 });
    await admin.from('takes').delete().in('id', data.map((t) => t.id));
    total += data.length;
  }
  return new Response(JSON.stringify({ deleted: total }), { headers: { 'Content-Type': 'application/json' } });
});
