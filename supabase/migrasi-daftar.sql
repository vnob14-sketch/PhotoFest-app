-- PhotoFest · MIGRASI PENDAFTARAN MANDIRI (aman dijalankan berulang kali)
-- 1) Katalog template/stiker dan design warna boleh dibaca siapa pun (isinya memang publik),
--    supaya halaman bisa tampil sebelum login.
drop policy if exists "baca katalog" on public.catalog;
create policy "baca katalog" on public.catalog for select to anon, authenticated using (active);
drop policy if exists "baca design" on public.designs;
create policy "baca design" on public.designs for select to anon, authenticated using (true);

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

-- 3) Izin baca untuk pengunjung yang belum login (diperlukan di project Supabase baru)
grant usage on schema public to anon, authenticated;
grant select on public.catalog, public.designs to anon, authenticated;
