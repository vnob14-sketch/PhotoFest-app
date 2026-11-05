-- PhotoFest · TANPA JATAH MINGGUAN · jalankan SEKALI di Supabase > SQL Editor (aman untuk instalasi lama)
-- Aturan baru: tiap akun punya memori maksimal N sesi (bawaan 10). Penuh = tidak bisa foto,
-- kecuali ada yang dihapus. Hapus 1 sesi = 1 slot kosong. Hapus otomatis tetap 7 hari per sesi (bukan per akun).

insert into public.settings values('gallery_max','10') on conflict (key) do nothing;
delete from public.settings where key='weekly_quota';

-- sesi yang dulu hanya "ditandai terhapus" (demi jatah) sekarang dibuang sungguhan
delete from public.takes where status='deleted';

drop function if exists public.admin_set_quota(int);
drop function if exists public.admin_list();

create or replace function public.quota_info() returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'gmax',(select (value#>>'{}')::int from settings where key='gallery_max'),
    'gcount',(select count(*) from takes where user_id=auth.uid() and status='ready' and expires_at>now())) $$;

create or replace function public.begin_take() returns uuid language plpgsql security definer set search_path=public as $$
declare g int; gc int; n uuid; s int;
begin
  if not exists(select 1 from profiles where id=auth.uid() and not disabled) then raise exception 'disabled'; end if;
  if not is_admin() then
    select (value#>>'{}')::int into g from settings where key='gallery_max';
    select count(*) into gc from takes where user_id=auth.uid() and status='ready' and expires_at>now();
    if g is not null and gc>=g then raise exception 'gallery_full'; end if;
  end if;
  select coalesce(max(seq),0)+1 into s from takes where user_id=auth.uid();
  insert into takes(user_id,seq) values(auth.uid(),s) returning id into n;
  return n;
end $$;

-- hapus 1 sesi: baris dibuang (client sudah menghapus file di Storage) -> slot langsung kosong
create or replace function public.delete_take(p_id uuid) returns void language sql security definer set search_path=public as $$
  delete from takes where id=p_id and user_id=auth.uid() $$;

create function public.admin_list() returns table(id uuid, username text, role text, disabled boolean, used bigint, created_at timestamptz)
language sql stable security definer set search_path=public as $$
  select p.id,p.username,p.role,p.disabled,
   (select count(*) from takes t where t.user_id=p.id and t.status='ready' and t.expires_at>now()), p.created_at
  from profiles p where public.is_admin() order by p.username $$;
revoke all on function public.admin_list() from public, anon;
grant execute on function public.admin_list() to authenticated;
