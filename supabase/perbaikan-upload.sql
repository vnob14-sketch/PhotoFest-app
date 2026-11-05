-- PhotoFest · PERBAIKAN UPLOAD ("new row violates row-level security policy")
-- Jalankan SEKALI di Supabase > SQL Editor. Aman diulang.

-- Cek kepemilikan take lewat fungsi security definer, supaya take berstatus 'pending'
-- (yang tidak terlihat oleh RLS tabel takes) tetap dikenali saat upload.
create or replace function public.can_write_take(p text) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from takes t where t.id::text=p and t.user_id=auth.uid()
    and t.status in ('pending','ready') and t.expires_at>now()) $$;
revoke all on function public.can_write_take(text) from public, anon;
grant execute on function public.can_write_take(text) to authenticated;

drop policy if exists "takes tulis" on storage.objects;
create policy "takes tulis" on storage.objects for insert to authenticated with check (
  bucket_id='takes' and (storage.foldername(name))[1]=auth.uid()::text
  and public.can_write_take((storage.foldername(name))[2]));

-- Sesi macet yang gagal upload (kosong, tidak ada file) memakai jatah. Bersihkan agar jatah kembali.
delete from public.takes where status='pending' and files='{}' and created_at < now() - interval '5 minutes';
