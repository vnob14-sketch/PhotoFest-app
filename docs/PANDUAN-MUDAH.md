# Panduan mudah (centang satu per satu)

[ ] 1. Supabase > Authentication > Sign In / Providers > Email: matikan "Confirm email". Biarkan "Allow new users to sign up" MENYALA
        (pengguna mendaftar sendiri). Kalau mau, bikin akun admin (langkah 3-4) dulu baru nyalakan.
[ ] 2. Supabase > SQL Editor: tempel seluruh isi `supabase/schema.sql`, klik Run. SEKALI saja.
[ ] 3. Supabase > Authentication > Users > Add user: email `admin@photofest.app`, isi password, centang Auto Confirm.
[ ] 4. SQL Editor, jalankan (tanpa tanda backtick):
        insert into public.profiles (id, username, role)
        select id, 'admin', 'admin' from auth.users where email = 'admin@photofest.app';
[ ] 5. Edge Functions > Deploy a new function (via editor). Buat dua fungsi:
        nama `admin-users`  -> tempel isi `supabase/functions/admin-users/index.ts`
        nama `cleanup-expired` -> tempel isi `supabase/functions/cleanup-expired/index.ts`
        Lalu Edge Functions > Secrets: tambah `CRON_SECRET` berisi teks acak (catat).
[ ] 6. Buka `tools/upload-assets.html` dengan klik dua kali. Isi Project URL dan service_role key,
        pilih folder `assets`, klik Mulai upload. Tunggu tulisan SELESAI.
[ ] 7. Buka `photofest.html` pakai Notepad, cari `ISI_SUPABASE_URL` dan `ISI_ANON_KEY`, ganti dengan
        Project URL dan anon key (Project Settings > API). Simpan.
[ ] 8. Upload `photofest.html` ke hosting, buka, login `admin`.
[ ] 9. Terakhir (hapus otomatis): Database > Extensions, aktifkan `pg_cron` dan `pg_net`, lalu jalankan SQL
        dari PANDUAN-SUPABASE.md langkah 7 (ganti XXX, ANON_KEY, ISI_CRON_SECRET).

Sudah pernah pasang versi lama? Cukup: (a) SQL Editor > jalankan `supabase/migrasi-daftar.sql`,
(b) deploy ulang fungsi `admin-users` dengan isi file terbaru, (c) nyalakan "Allow new users to sign up", (d) upload `photofest.html` baru.

## Update fitur GALERI (untuk yang sudah pernah pasang)
[ ] A. SQL Editor > jalankan `supabase/migrasi-galeri.sql` (sekali saja). Ini menambah batas maksimal galeri, nomor sesi, dan izin simpan data edit.
[ ] B. Edge Functions > deploy ulang `cleanup-expired` dengan isi file terbaru (supaya foto mentah dan data edit ikut terhapus otomatis).
[ ] C. Upload `photofest.html` yang baru.
[ ] D. (Opsional) Panel admin > Jatah > atur "Maksimal sesi di Galeri per akun" (bawaan 10).
Instalasi baru: cukup jalankan `schema.sql` seperti biasa, galeri sudah termasuk.
Catatan: sesi lama (sebelum update) tetap tampil di galeri dan bisa didownload, tapi tidak bisa diedit kembali.


## Update: TANPA JATAH MINGGUAN (untuk yang sudah pernah pasang)
[ ] 1. SQL Editor > jalankan `supabase/migrasi-tanpa-kuota.sql` (sekali saja). Jangan jalankan ulang `migrasi-galeri.sql` setelah ini.
[ ] 2. Upload `photofest.html` yang baru.
Aturan baru: tiap akun punya memori 10 sesi (ubah di Panel admin > Memori). Penuh = tidak bisa foto; hapus 1 sesi = 1 slot kosong. Hapus otomatis tetap 7 hari per sesi.
Instalasi baru: cukup `schema.sql` (sudah versi baru).
