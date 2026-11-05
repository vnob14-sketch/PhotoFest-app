# PhotoFest Desktop (Windows)

Aplikasi photobooth PhotoFest sebagai program Windows (Electron). Semua fitur web PhotoFest dibawa: template, stiker, efek/lensa, GIF animasi, strip 5x15 cm, mode 2/3 foto, editor, galeri, room multi-pemain, akun + panel admin (mode Online), plus fitur desktop:

- **Penyimpanan**: internal (`Pictures\PhotoFest`), folder pilihan (disk lain, flashdisk, NAS), folder cloud yang terdeteksi (Google Drive for Desktop, OneDrive, Dropbox, iCloud, MEGA, dll), dan upload otomatis ke Google Drive lewat API (opsional).
- **Printer**: semua printer yang terpasang di Windows; pilih printer, salinan, cetak diam-diam atau lewat dialog Windows, halaman tes cetak.
- **Kamera**: semua kamera yang dikenali Windows; resolusi dan kontrol manual yang didukung driver (exposure, shutter, ISO bila ada, white balance, fokus, zoom). DSLR/mirrorless: ISO, aperture, shutter, white balance, dll lewat digiCamControl.

Struktur penyimpanan (sama di semua tujuan): `PhotoFest/print`, `PhotoFest/animated`, `PhotoFest/original`, `PhotoFest/_data` (data edit ulang).

## Menjalankan
```
npm install      # juga menyalin library ke app/vendor dan membuat manifest aset
npm start
```
## Membuat .exe di GitHub
1. Buat repo, push semua isi folder ini (setelah `npm install`, commit juga `package-lock.json`).
2. Tab **Actions > Build PhotoFest (Windows) > Run workflow**, atau buat tag: `git tag v1.0.0 && git push --tags`.
3. Hasil: installer `PhotoFest-1.0.0-nsis.exe` dan `PhotoFest-1.0.0-portable.exe` di Artifacts (dan di Releases bila memakai tag).
Lokal di Windows: `npm run dist` (hasil di `dist/`).

## Mode akun
Pengaturan > Aplikasi. **Lokal** (bawaan): tanpa login, file di komputer ini, cocok untuk mesin photobooth. **Online**: akun + galeri Supabase seperti versi web (isi `CFG` di akhir `app/photofest.html`; panduan di `docs/` dan folder `supabase/`); setiap file tetap disalin ke penyimpanan pilihan.

## Aset (template, stiker, background)
`assets.zip` berisi 62 template dan 101 stiker; otomatis diekstrak ke `app/assets/` saat `npm install` (supaya repo hanya ~40 file dan mudah diunggah lewat web GitHub).
Zip sumber hanya berisi 62 template dan 101 stiker baru. Sisanya (17 template, 82 stiker lama, background, logo, mesin) tidak ada di zip, jadi diambil dari Supabase saat online. Agar penuh offline: salin folder `assets/files/*` lama (`templates/`, `stickers/`, `bgs/`, `logos/`, `site/`) ke `app/assets/`, lalu `npm run assets`.
Font Google Fonts juga dimuat dari internet; tanpa internet tampil font cadangan.

## Kamera DSLR / mirrorless (digiCamControl)
1. Pasang digiCamControl (gratis), sambungkan kamera lewat USB.
2. Settings > Webserver > centang "Use web server" (port 5513).
3. Di PhotoFest: Pengaturan > Kamera > bagian DSLR; pilih "DSLR / Mirrorless" di daftar kamera pada halaman foto.
Webcam biasa tidak punya aperture; ISO/shutter hanya muncul bila driver webcam mendukung. Kamera yang dipasang lewat utilitas webcam resmi (Canon EOS Webcam Utility, dll) muncul sebagai kamera biasa.

## Google Drive lewat API (opsional)
Tidak perlu bila memakai Google Drive for Desktop. Jika ingin: Google Cloud Console > buat project > aktifkan Google Drive API > OAuth consent screen > Credentials > OAuth client ID tipe **Desktop app**. Salin Client ID dan Secret ke Pengaturan > Penyimpanan > Hubungkan Google. Izin yang diminta hanya `drive.file` (aplikasi hanya melihat file buatannya sendiri). File yang dihapus di komputer tidak dihapus di Drive.

## Catatan
Belum ada lisensi di repo; tambahkan sesuai kebutuhan. Folder `supabase/` dan `tools/` dibawa apa adanya dari versi web.
