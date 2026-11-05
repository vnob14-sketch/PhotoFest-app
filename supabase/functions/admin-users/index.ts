// Kelola akun (butuh service role, jadi hanya jalan di server). Hanya admin yang boleh memanggil.
import { createClient } from 'npm:@supabase/supabase-js@2';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const DOM = Deno.env.get('ACCOUNT_DOMAIN') ?? 'photofest.app';
const NAMES = ['print.jpg', 'strip.gif', 'orig.gif'];
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: u } = await admin.auth.getUser((req.headers.get('Authorization') ?? '').replace('Bearer ', ''));
  if (!u?.user) return j({ error: 'unauthorized' }, 401);
  const { data: me } = await admin.from('profiles').select('role,disabled').eq('id', u.user.id).single();
  if (me?.role !== 'admin' || me.disabled) return j({ error: 'forbidden' }, 403);
  const b = await req.json();
  if (b.action === 'create') {
    const results = [];
    for (const x of (b.users ?? []).slice(0, 100)) {
      const username = String(x.username ?? '').toLowerCase(), password = String(x.password ?? '');
      if (!/^[a-z0-9._-]{3,30}$/.test(username) || password.length < 8) { results.push({ username, ok: false, err: 'format salah' }); continue; }
      const { data, error } = await admin.auth.admin.createUser({ email: `${username}@${DOM}`, password, email_confirm: true });
      if (error || !data.user) { results.push({ username, ok: false, err: 'nama sudah dipakai' }); continue; }
      // profil biasanya sudah dibuat otomatis oleh trigger; upsert ini hanya jaga-jaga
      const { error: e2 } = await admin.from('profiles').upsert({ id: data.user.id, username }, { onConflict: 'id', ignoreDuplicates: true });
      if (e2) { await admin.auth.admin.deleteUser(data.user.id); results.push({ username, ok: false, err: 'gagal simpan' }); continue; }
      results.push({ username, ok: true });
    }
    return j({ results });
  }
  const id = String(b.id ?? '');
  const { data: t } = await admin.from('profiles').select('role').eq('id', id).single();
  if (!t || t.role === 'admin') return j({ error: 'akun tidak valid' }, 400);
  if (b.action === 'reset') {
    if (String(b.password ?? '').length < 8) return j({ error: 'password pendek' }, 400);
    await admin.auth.admin.updateUserById(id, { password: b.password });
  } else if (b.action === 'disable' || b.action === 'enable') {
    const off = b.action === 'disable';
    await admin.auth.admin.updateUserById(id, { ban_duration: off ? '876000h' : 'none' });
    await admin.from('profiles').update({ disabled: off }).eq('id', id);
  } else if (b.action === 'delete') {
    const { data: tk } = await admin.from('takes').select('id').eq('user_id', id);
    const paths = (tk ?? []).flatMap((x) => NAMES.map((n) => `${id}/${x.id}/${n}`));
    if (paths.length) await admin.storage.from('takes').remove(paths);
    await admin.auth.admin.deleteUser(id); // profiles + takes ikut terhapus (cascade)
  } else return j({ error: 'aksi tidak dikenal' }, 400);
  return j({ ok: true });
});
