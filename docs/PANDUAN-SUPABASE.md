# PhotoFest + Supabase

## Keputusan
- **Memori: 10 sesi per akun** (bisa diubah admin di Panel admin > Memori). Penuh = tidak bisa foto sampai ada sesi yang dihapus; hapus 1 sesi = 1 slot kosong. Untuk 500 akun, worst case 5.000 sesi x 2 sampai 3 MB = 10 sampai 15 GB (butuh Supabase Pro); kurangi batasnya kalau akunnya banyak.
- **1 take = 3 file**: foto print view (JPEG), GIF print view (strip), GIF asli.
- **Hapus otomatis tiap sesi 7 hari setelah difoto** (dihitung per sesi/foto, bukan per akun), lalu slotnya kosong lagi. Hapus manual juga langsung mengosongkan slot.
- **Kode room tidak disimpan di mana pun.** Ia hanya ada selama room aktif (PeerJS), hilang saat host keluar.
- Tamu yang masuk room tetap perlu login; sesi yang tersimpan masuk ke memori akun host.

## Galeri
- Menu akun (tombol **G**, kanan atas) membuka **Galeri**: daftar sesi (Sesi 1, Sesi 2, ...) lengkap dengan sisa hari sebelum terhapus otomatis.
- Klik sesi: tampil **Foto print view**, **GIF print view**, **GIF original**, masing-masing bisa didownload. Tombol **Edit kembali** membuka foto dan dekor sesi itu di editor; setelah *Selesai, cetak!* hasilnya menggantikan sesi tersebut (waktu hapus otomatis tidak diperpanjang). Tombol **Hapus** menghapus sesi dan mengosongkan ruang galeri.
- Batas memori: **10 sesi per akun** (ubah di Panel admin > Memori). Menu **Lanjut foto** menghilang saat penuh dan muncul lagi setelah satu sesi dihapus. Dicek juga di server (`begin_take`).
- Tiap sesi kini menyimpan sampai 9 file: 3 hasil (`print.jpg`, `strip.gif`, `orig.gif`) + data edit (`raw0-3.jpg`, `clips.jpg`, `state.json`). Perkiraan 3 sampai 5 MB per sesi, jadi perhitungan penyimpanan di atas perlu dikali sekitar 1,5.
- Sudah pasang versi lama? Jalankan `supabase/migrasi-galeri.sql` dan deploy ulang `cleanup-expired`.

## Privasi
- Bucket `takes` privat. Akses hanya lewat signed URL (5 menit untuk pratinjau, 1 menit untuk download), dan hanya pemilik folder `<user_id>/`.
- **Admin tidak bisa melihat foto siapa pun**, hanya daftar akun dan jumlah pemakaian.
- Password disimpan Supabase Auth (hash). Admin hanya melihat password sekali saat dibuat/direset.
- Sesi login disimpan di sessionStorage (tutup tab = keluar), cocok untuk perangkat bersama.
- Pengguna biasa mendaftar sendiri (tab Daftar di awal halaman). Admin tetap bisa membuat akun massal. Login admin ada di tautan "Masuk admin" di bagian bawah halaman.

## Pasang (urut)
1. Buat project di supabase.com.
2. **Authentication > Providers > Email**: matikan *Confirm email*; biarkan *Allow new users to sign up* menyala (pendaftaran mandiri).
3. **SQL Editor**: jalankan seluruh `supabase/schema.sql`.
4. **Edge Functions**: deploy `admin-users` dan `cleanup-expired` (isi dari folder `supabase/functions`, bisa lewat dashboard atau `supabase functions deploy`).
   Di *Edge Functions > Secrets* tambah `CRON_SECRET` (teks acak panjang).
5. **Admin pertama**: Authentication > Users > Add user, email `admin@photofest.app`, isi password, centang auto confirm. Lalu di SQL Editor:
   `insert into profiles(id,username,role) select id,'admin','admin' from auth.users where email='admin@photofest.app';`
6. **Upload aset dan template** (108 file sudah diekstrak di `assets/`):
   `npm i @supabase/supabase-js` lalu
   `SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... node tools/upload-assets.mjs`
   (service role key jangan pernah ditaruh di HTML).
7. **Jadwal hapus otomatis** (SQL Editor, aktifkan extension `pg_cron` dan `pg_net` dulu):
   ```sql
   select cron.schedule('pf-cleanup','0 * * * *',$$
     select net.http_post(url:='https://XXX.supabase.co/functions/v1/cleanup-expired',
       headers:='{"Content-Type":"application/json","Authorization":"Bearer ANON_KEY","x-cron-secret":"ISI_CRON_SECRET"}'::jsonb) $$);
   ```
8. Buka `photofest.html`, cari `CFG` di bagian paling bawah, isi `url` dan `key` (anon key, aman di sisi klien). Upload ke hosting.
9. Login sebagai `admin` > **Panel admin** (link di footer) > buat akun massal (awalan + jumlah), unduh CSV berisi password.

## Catatan
- Nama akun diubah jadi email palsu `nama@photofest.app` (tidak ada email dikirim). Ganti `domain` di `CFG` dan secret `ACCOUNT_DOMAIN` kalau mau.
- Template baru: taruh file .webp di bucket `assets` dan tambah baris di tabel `catalog` (lihat `assets/manifest.json` sebagai contoh). Tidak ada UI upload template.
- Library Supabase dimuat dari jsDelivr (versi dikunci). Untuk privasi maksimal, unduh dan host sendiri lalu ubah CSP.
