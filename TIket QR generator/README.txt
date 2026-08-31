PAKET DEMO SISTEM TIKET QR - BAZNAS SRAGEN

File:
- index.html      = pendaftaran + generate ID
- tiket.html      = tiket digital + QR
- scanner.html    = scanner QR via kamera
- dashboard.html  = daftar peserta + statistik + export CSV

CARA MENCOBA:
1. Buka index.html melalui web server lokal/hosting.
2. Daftarkan peserta.
3. Tiket QR muncul.
4. Buka scanner.html pada perangkat scanner.
5. Scan QR tiket.
6. Dashboard menampilkan status check-in.

CATATAN PENTING:
Versi ini adalah DEMO dan menyimpan database di localStorage browser.
Artinya data tidak otomatis sinkron antar HP/perangkat.

Untuk acara sungguhan dengan banyak panitia, tahap berikutnya adalah mengganti
localStorage dengan database online (misalnya Firebase/Supabase), sehingga satu
QR hanya dapat dipakai sekali dan status scan tersimpan realtime.
