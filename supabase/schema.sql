-- PhotoFest · jalankan SEKALI di Supabase > SQL Editor
create table public.settings(key text primary key, value jsonb not null);
insert into public.settings values('gallery_max','10');

create table public.profiles(
  id uuid primary key references auth.users on delete cascade,
  username text unique not null check (username ~ '^[a-z0-9._-]{3,30}$'),
  role text not null default 'user' check (role in ('user','admin')),
  disabled boolean not null default false,
  created_at timestamptz not null default now());

-- 1 baris = 1 take (foto print view + GIF print view + GIF asli)
create table public.takes(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  status text not null default 'pending' check (status in ('pending','ready','deleted')),
  files text[] not null default '{}',
  seq int,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days');
create index on public.takes(user_id, created_at);
create index on public.takes(expires_at);

create table public.designs(
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 1 and 30),
  bg text not null check (bg ~* '^#[0-9a-f]{6}$'), fg text not null check (fg ~* '^#[0-9a-f]{6}$'),
  ac text not null check (ac ~* '^#[0-9a-f]{6}$'),
  pt text not null check (pt in ('none','dots','stripes','grid','confetti')),
  created_at timestamptz not null default now());

-- katalog aset: background, logo, template, stiker (file ada di bucket "assets")
create table public.catalog(
  id bigint generated always as identity primary key,
  kind text not null, key text not null, name text, path text not null,
  meta jsonb not null default '{}', sort int not null default 0, active boolean not null default true,
  unique(kind, key));

alter table public.settings enable row level security;
alter table public.profiles enable row level security;
alter table public.takes enable row level security;
alter table public.designs enable row level security;
alter table public.catalog enable row level security;

create function public.is_admin() returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from profiles where id=auth.uid() and role='admin' and not disabled) $$;

create policy "profil sendiri" on public.profiles for select to authenticated using (id=auth.uid() or public.is_admin());
-- takes: hanya pemilik, hanya yang siap dan belum kedaluwarsa. Admin TIDAK bisa melihat foto/take siapa pun.
create policy "take sendiri" on public.takes for select to authenticated
  using (user_id=auth.uid() and status='ready' and expires_at>now());
create policy "baca setelan" on public.settings for select to authenticated using (true);
create policy "baca design" on public.designs for select to anon, authenticated using (true);
create policy "admin tambah design" on public.designs for insert to authenticated with check (public.is_admin());
create policy "baca katalog" on public.catalog for select to anon, authenticated using (active);

-- memori: tiap akun maksimal gallery_max sesi (hapus 1 sesi = 1 slot kosong)
create function public.quota_info() returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'gmax',(select (value#>>'{}')::int from settings where key='gallery_max'),
    'gcount',(select count(*) from takes where user_id=auth.uid() and status='ready' and expires_at>now())) $$;

create function public.begin_take() returns uuid language plpgsql security definer set search_path=public as $$
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

create function public.finish_take(p_id uuid, p_files text[]) returns void language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from unnest(p_files) f where f not like auth.uid()::text||'/'||p_id::text||'/%') then raise exception 'bad_files'; end if;
  update takes set status='ready', files=p_files
   where id=p_id and user_id=auth.uid() and status in ('pending','ready') and expires_at>now();
end $$;

-- hapus manual: client menghapus file di Storage dulu, lalu memanggil ini. Baris dibuang -> slot galeri kosong lagi.
create function public.delete_take(p_id uuid) returns void language sql security definer set search_path=public as $$
  delete from takes where id=p_id and user_id=auth.uid() $$;

create function public.admin_list() returns table(id uuid, username text, role text, disabled boolean, used bigint, created_at timestamptz)
language sql stable security definer set search_path=public as $$
  select p.id,p.username,p.role,p.disabled,
   (select count(*) from takes t where t.user_id=p.id and t.status='ready' and t.expires_at>now()), p.created_at
  from profiles p where public.is_admin() order by p.username $$;

create function public.admin_set_gallery_max(q int) returns void language plpgsql security definer set search_path=public as $$
begin
  if not is_admin() or q<1 or q>100 then raise exception 'forbidden'; end if;
  insert into settings values('gallery_max',to_jsonb(q)) on conflict (key) do update set value=excluded.value;
end $$;

revoke all on function public.is_admin(), public.quota_info(), public.begin_take(), public.finish_take(uuid,text[]),
  public.delete_take(uuid), public.admin_list(), public.admin_set_gallery_max(int) from public, anon;
grant execute on function public.is_admin(), public.quota_info(), public.begin_take(), public.finish_take(uuid,text[]),
  public.delete_take(uuid), public.admin_list(), public.admin_set_gallery_max(int) to authenticated;

-- STORAGE: "takes" = PRIVAT (foto pengguna), "assets" = publik (template, stiker, logo)
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('takes','takes',false,10485760,array['image/jpeg','image/gif','application/json']),
       ('assets','assets',true,5242880,array['image/webp','image/png','image/jpeg'])
on conflict (id) do update set public=excluded.public, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;

-- path file: <user_id>/<take_id>/<nama>. Hanya pemilik take yang masih aktif.
create policy "takes baca" on storage.objects for select to authenticated using (
  bucket_id='takes' and (storage.foldername(name))[1]=auth.uid()::text and exists(
   select 1 from public.takes t where t.id::text=(storage.foldername(name))[2] and t.user_id=auth.uid() and t.expires_at>now()));
create policy "takes tulis" on storage.objects for insert to authenticated with check (
  bucket_id='takes' and (storage.foldername(name))[1]=auth.uid()::text and exists(
   select 1 from public.takes t where t.id::text=(storage.foldername(name))[2] and t.user_id=auth.uid()
   and t.status in ('pending','ready') and t.expires_at>now()));
create policy "takes timpa" on storage.objects for update to authenticated using (
  bucket_id='takes' and (storage.foldername(name))[1]=auth.uid()::text) with check (
  bucket_id='takes' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "takes hapus" on storage.objects for delete to authenticated using (
  bucket_id='takes' and (storage.foldername(name))[1]=auth.uid()::text);

-- PENDAFTARAN MANDIRI: profil otomatis untuk akun baru
-- 2) Setiap akun baru otomatis dibuatkan profil (role selalu 'user').
--    Nama akun diambil dari bagian depan email palsu (nama@photofest.app).
--    'admin' dicadangkan: dibuat manual lewat langkah admin pertama.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path=public as $$
declare u text := lower(split_part(new.email,'@',1));
begin
  if u = 'admin' then return new; end if;
  insert into public.profiles(id, username) values (new.id, u) on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
