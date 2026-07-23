# Bot WhatsApp Rekap Keuangan Pribadi

Bot WhatsApp untuk mencatat pengeluaran dan pemasukan uang pribadi secara otomatis ke Google Sheets, cukup dengan mengirim pesan chat.

## Fitur

- Catat pengeluaran/pemasukan lewat chat WhatsApp
- Data otomatis tersimpan ke Google Sheets (No, Tanggal, Nama, Pengeluaran, Pemasukan, Total)
- Saldo berjalan (Total) terhitung otomatis di setiap transaksi baru
- Rekap total pemasukan/pengeluaran bulan berjalan
- Lihat riwayat 5 transaksi terakhir
- Hapus transaksi terakhir (dengan konfirmasi) kalau salah input
- Dua cara input: menu bertahap atau shortcut satu baris

## Tech Stack

| Komponen | Teknologi |
|---|---|
| Runtime | Node.js (ES Modules) |
| Koneksi WhatsApp | [Baileys](https://github.com/WhiskeySockets/Baileys) (unofficial WhatsApp Web API) |
| Penyimpanan data | Google Sheets (via Google Sheets API) |
| Autentikasi Google | Service Account (`credentials.json`) |

## Struktur Project

```
chatbot-whatsapp/
├── auth_info/          # sesi login WhatsApp (auto-generated, jangan dihapus kecuali ganti nomor)
├── credentials.json    # kredensial Google Service Account (RAHASIA, jangan di-share/commit)
├── .env                # konfigurasi environment
├── index.js            # entry point bot (koneksi WA + logika command)
├── sheets.js            # modul koneksi & operasi ke Google Sheets
├── package.json
└── README.md
```

## Setup Awal

### 1. Install dependencies

```bash
npm install
```

### 2. Siapkan Google Sheets

1. Buat spreadsheet baru, isi baris pertama (header) dengan kolom:
   `No | Tanggal | Nama | Pengeluaran | Pemasukan | Total`
2. Nama tab sheet default: `Sheet1`.

### 3. Setup Google Service Account

1. Buka [Google Cloud Console](https://console.cloud.google.com/) → buat project baru.
2. Aktifkan **Google Sheets API** (APIs & Services → Library).
3. Buat **Service Account** (APIs & Services → Credentials → Create Credentials).
4. Generate **JSON key** dari service account tersebut, rename jadi `credentials.json`, taruh di root folder project.
5. Ambil `client_email` dari file itu, lalu **Share** Google Sheet kamu ke email tersebut dengan akses **Editor**.

### 4. Buat file `.env`

```
SPREADSHEET_ID=isi_dengan_spreadsheet_id_dari_url_sheet
SHEET_NAME=Sheet1
OWNER_JID=isi_setelah_bot_pertama_kali_dijalankan
```

- `SPREADSHEET_ID` — diambil dari URL Google Sheet, bagian setelah `/d/` dan sebelum `/edit`.
- `OWNER_JID` — ID unik pengirim yang boleh chat ke bot. **Belum diisi di awal** — lihat langkah "Cara Ambil OWNER_JID" di bawah.

> Catatan: sebagian akun WhatsApp sekarang memakai sistem **LID (Linked ID)**, sehingga identitas pengirim bukan lagi format nomor telepon biasa (`62xxx@s.whatsapp.net`), melainkan ID acak (`xxxxx@lid`). Karena itu `OWNER_JID` diisi dengan JID mentah apa adanya, bukan disusun dari nomor telepon.

### 5. Jalankan bot & scan QR

```bash
node index.js
```

Scan QR yang muncul di terminal menggunakan WhatsApp di HP (Setelan → Perangkat Tertaut → Tautkan Perangkat).

### 6. Cara ambil `OWNER_JID`

1. Setelah bot terhubung, kirim pesan apa saja dari nomor yang ingin dijadikan "pemilik bot".
2. Lihat log di terminal, cari baris `remoteJid: ...` — itu adalah JID yang perlu disalin.
3. Tempel nilai itu ke `.env` sebagai `OWNER_JID`, lalu jalankan ulang bot.

## Daftar Command

| Command | Fungsi |
|---|---|
| `catat` atau `menu` | Mulai alur menu bertahap (pilih tipe transaksi lalu isi detail) |
| `pengeluaran <nominal> - <keterangan>` | Catat pengeluaran langsung dalam satu baris |
| `pemasukan <nominal> - <keterangan>` | Catat pemasukan langsung dalam satu baris |
| `rekap` | Lihat total pemasukan, pengeluaran, dan saldo bulan berjalan |
| `terakhir` atau `riwayat` | Lihat 5 transaksi terakhir |
| `hapus terakhir` atau `hapus` | Hapus transaksi paling akhir (perlu konfirmasi "ya") |
| `batal` | Batalkan alur menu/hapus yang sedang berjalan |
| `help` atau `bantuan` | Tampilkan daftar command |

Nominal mendukung format titik ribuan (`50.000`) dan singkatan (`5rb`, `2jt`).

### Contoh

```
Kamu: pengeluaran 50.000 - makan siang
Bot : 💸 Pengeluaran tercatat: Rp50.000 - makan siang
      Saldo sekarang: Rp1.950.000

Kamu: rekap
Bot : 📊 Rekap Bulan Ini
      Pemasukan: Rp2.000.000
      Pengeluaran: Rp750.000
      Saldo saat ini: Rp1.250.000
```

## Menjalankan Bot Terus-Menerus (Opsional)

Secara default, bot berhenti kalau terminal ditutup atau laptop dimatikan. Untuk menjaga proses tetap jalan di background selama laptop menyala, bisa pakai **PM2**:

```bash
npm install -g pm2
pm2 start index.js --name bot-keuangan
pm2 save
```

- Lihat log: `pm2 logs bot-keuangan`
- Stop bot: `pm2 stop bot-keuangan`

> Catatan: PM2 hanya menjaga proses tetap jalan selama laptop menyala. Untuk bot yang tetap aktif walau laptop mati total, proses perlu dipindahkan ke server/VPS yang menyala 24/7.

## Ganti ke Nomor WhatsApp Lain

1. Stop bot (`Ctrl+C` atau `pm2 stop bot-keuangan`).
2. Hapus folder `auth_info`.
3. Jalankan ulang `node index.js`, scan QR dengan nomor baru.
4. Kirim 1 pesan test dari nomor yang ingin dijadikan pemilik, salin `remoteJid` dari log terminal.
5. Update `OWNER_JID` di `.env` dengan nilai tersebut.

## Troubleshooting

| Masalah | Kemungkinan Penyebab & Solusi |
|---|---|
| `Error [ERR_REQUIRE_ESM]` | Pastikan `package.json` punya `"type": "module"` dan semua file pakai sintaks `import`/`export`, bukan `require` |
| Bot terhubung tapi tidak membalas | Cek log `remoteJid` di terminal — cocokkan dengan `OWNER_JID` di `.env` |
| `The caller does not have permission` | Google Sheet belum di-share ke email service account dengan akses Editor |
| `Unable to parse range` | `SHEET_NAME` di `.env` tidak sama persis dengan nama tab di Google Sheets |
| Data masuk tapi kolom tertukar | Cek urutan header sheet: `No, Tanggal, Nama, Pengeluaran, Pemasukan, Total` |
| Koneksi WA sering putus | Baileys otomatis reconnect; kalau tetap gagal, hapus folder `auth_info` dan scan ulang |

## Keamanan

- `credentials.json` dan `.env` berisi kredensial sensitif — **jangan** di-commit ke Git publik atau dibagikan ke siapa pun.
- Tambahkan ke `.gitignore`:
  ```
  credentials.json
  .env
  auth_info/
  node_modules/
  ```