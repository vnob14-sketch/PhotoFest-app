-- USANG: jangan dijalankan lagi. Aturan jatah mingguan sudah diganti, pakai migrasi-tanpa-kuota.sql / schema.sql.
-- PhotoFest · GALERI · jalankan SEKALI di Supabase > SQL Editor (aman untuk instalasi lama)

-- 1) Batas maksimal sesi di galeri per akun (admin bisa mengubah di Panel admin > Jatah)
insert into public.settings values('gallery_max','10') on conflict (key) do nothing;

-- 2) Nomor sesi per akun (Sesi 1, Sesi 2, ...)
alter table public.takes add column if not exists seq int;
update public.takes t set seq = s.n from (
  select id, row_number() over (partition by user_id order by created_at) n from public.takes) s
where t.id = s.id and t.seq is null;

-- 3) Bucket takes boleh menyimpan state.json (data untuk edit kembali)
update storage.buckets set allowed_mime_types = array['image/jpeg','image/gif','application/json'] where id='takes';

-- 4) Info jatah + info galeri
create or replace function public.quota_info() returns jsonb language sql stable security definer set search_path=public as $$
  with c as (select created_at from takes where user_id=auth.uid() and created_at>now()-interval '7 days'
             and (status<>'pending' or created_at>now()-interval '2 hours'))
  select jsonb_build_object('quota',(select (value#>>'{}')::int from settings where key='weekly_quota'),
    'used',(select count(*) from c),'next',(select min(created_at)+interval '7 days' from c),
    'gmax',(select (value#>>'{}')::int from settings where key='gallery_max'),
    'gcount',(select count(*) from takes where user_id=auth.uid() and status='ready' and expires_at>now())) $$;

-- 5) Mulai sesi baru: cek galeri penuh + beri nomor sesi
create or replace function public.begin_take() returns uuid language plpgsql security definer set search_path=public as $$
declare q int; u int; g int; gc int; n uuid; s int;
begin
  if not exists(select 1 from profiles where id=auth.uid() and not disabled) then raise exception 'disabled'; end if;
  if not is_admin() then
    select (value#>>'{}')::int into q from settings where key='weekly_quota';
    select count(*) into u from takes where user_id=auth.uid() and created_at>now()-interval '7 days'
      and (status<>'pending' or created_at>now()-interval '2 hours');
    if u>=q then raise exception 'quota_exceeded'; end if;
    select (value#>>'{}')::int into g from settings where key='gallery_max';
    select count(*) into gc from takes where user_id=auth.uid() and status='ready' and expires_at>now();
    if g is not null and gc>=g then raise exception 'gallery_full'; end if;
  end if;
  select coalesce(max(seq),0)+1 into s from takes where user_id=auth.uid();
  insert into takes(user_id,seq) values(auth.uid(),s) returning id into n;
  return n;
end $$;

-- 6) Admin: ubah batas galeri
create or replace function public.admin_set_gallery_max(q int) returns void language plpgsql security definer set search_path=public as $$
begin
  if not is_admin() or q<1 or q>100 then raise exception 'forbidden'; end if;
  insert into settings values('gallery_max',to_jsonb(q)) on conflict (key) do update set value=excluded.value;
end $$;
revoke all on function public.admin_set_gallery_max(int) from public, anon;
grant execute on function public.admin_set_gallery_max(int) to authenticated;
