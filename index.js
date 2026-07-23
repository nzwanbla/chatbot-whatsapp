import 'dotenv/config';
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import P from 'pino';
import { catatTransaksi, rekapBulanIni, transaksiTerakhir, hapusTerakhir } from './sheets.js';

const OWNER_JID = process.env.OWNER_JID;
const sesi = new Map();

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: P({ level: 'silent' })
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) qrcode.generate(qr, { small: true });

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Koneksi terputus, reconnect:', shouldReconnect);
      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      console.log('✅ Bot WhatsApp terhubung!');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const msg = messages[0];

    console.log('=== PESAN MASUK ===');
    console.log('remoteJid:', msg.key.remoteJid);
    console.log('fromMe:', msg.key.fromMe);
    console.log('OWNER_JID di .env:', OWNER_JID);

    if (!msg.message || msg.key.fromMe) return;

    const sender = msg.key.remoteJid;
    if (OWNER_JID && sender !== OWNER_JID) {
      console.log('❌ Ditolak karena sender tidak cocok dengan OWNER_JID');
      return;
    }

    const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
    console.log('Isi pesan:', text);
    if (!text) return;

    const reply = await handleMessage(sender, text);
    if (reply) {
      await sock.sendMessage(sender, { text: reply });
    }
  });
}

function parseNominal(str) {
  str = str.trim().toLowerCase().replace(/\./g, '').replace(/,/g, '');
  let multiplier = 1;
  if (str.endsWith('jt') || str.endsWith('juta')) {
    multiplier = 1000000;
    str = str.replace(/jt|juta/g, '');
  } else if (str.endsWith('rb') || str.endsWith('ribu') || str.endsWith('k')) {
    multiplier = 1000;
    str = str.replace(/ribu|rb|k/g, '');
  }
  const num = parseFloat(str);
  if (isNaN(num)) return null;
  return Math.round(num * multiplier);
}

function normalizeTipe(kata) {
  const map = { 'pengeluaran': 'keluar', 'keluar': 'keluar', 'pemasukan': 'masuk', 'masuk': 'masuk' };
  return map[kata] || null;
}

async function prosesCatat(tipe, nominal, keterangan) {
  try {
    const { newTotal } = await catatTransaksi(tipe, nominal, keterangan);
    const emoji = tipe === 'masuk' ? '💰' : '💸';
    const label = tipe === 'masuk' ? 'Pemasukan' : 'Pengeluaran';
    return `${emoji} ${label} tercatat: Rp${nominal.toLocaleString('id-ID')} - ${keterangan}\nSaldo sekarang: Rp${newTotal.toLocaleString('id-ID')}`;
  } catch (err) {
    console.error(err.message);
    return '❌ Gagal mencatat ke spreadsheet. Cek koneksi internet / izin akses sheet.';
  }
}

async function handleMessage(sender, text) {
  const lower = text.toLowerCase().trim();
  const state = sesi.get(sender);

  if (lower === 'batal') {
    sesi.delete(sender);
    return '🚫 Dibatalkan.';
  }

  if (state?.step === 'konfirmasi_hapus') {
    if (lower === 'ya' || lower === 'y') {
      sesi.delete(sender);
      try {
        const dihapus = await hapusTerakhir();
        if (!dihapus) return '📭 Tidak ada transaksi untuk dihapus.';
        const emoji = dihapus.tipe === 'masuk' ? '💰' : '💸';
        return `🗑️ Dihapus: ${emoji} ${dihapus.nama} - Rp${dihapus.nominal.toLocaleString('id-ID')}`;
      } catch (err) {
        console.error(err.message);
        return '❌ Gagal menghapus dari spreadsheet.';
      }
    }
    sesi.delete(sender);
    return '🚫 Dibatalkan, tidak ada yang dihapus.';
  }

  if (state?.step === 'pilih_tipe') {
    let tipe = null;
    if (lower === '1' || lower === 'pengeluaran' || lower === 'keluar') tipe = 'keluar';
    else if (lower === '2' || lower === 'pemasukan' || lower === 'masuk') tipe = 'masuk';

    if (!tipe) {
      return '⚠️ Pilih salah satu ya:\n1. Pengeluaran\n2. Pemasukan\n\n(ketik "batal" untuk membatalkan)';
    }

    sesi.set(sender, { step: 'input_detail', tipe });
    const label = tipe === 'masuk' ? 'pemasukan' : 'pengeluaran';
    return `Oke, ${label}. Sekarang kirim nominal dan keterangannya.\nContoh: 50000 makan siang`;
  }

  if (state?.step === 'input_detail') {
    const match = text.trim().match(/^([\d.,a-z]+)\s*-?\s*(.*)$/i);
    if (!match) {
      return '⚠️ Format belum kebaca. Contoh: 50000 makan siang (ketik "batal" untuk membatalkan)';
    }

    const nominal = parseNominal(match[1]);
    const keterangan = match[2].trim() || '-';

    if (!nominal || nominal <= 0) {
      return '⚠️ Nominal tidak dikenali. Contoh: 50000 makan siang';
    }

    sesi.delete(sender);
    return await prosesCatat(state.tipe, nominal, keterangan);
  }

  if (lower === 'catat' || lower === 'menu') {
    sesi.set(sender, { step: 'pilih_tipe' });
    return '📋 Mau catat apa?\n1. Pengeluaran\n2. Pemasukan\n\n(ketik "batal" untuk membatalkan)';
  }

  const matchLangsung = lower.match(/^(pengeluaran|pemasukan|keluar|masuk)\s+([\d.,a-z]+)\s*-?\s*(.*)$/i);
  if (matchLangsung) {
    const tipe = normalizeTipe(matchLangsung[1]);
    const nominal = parseNominal(matchLangsung[2]);
    const keterangan = matchLangsung[3].replace(/^-+\s*/, '').trim() || '-';

    if (!nominal || nominal <= 0) {
      return '⚠️ Nominal tidak dikenali. Contoh: "pengeluaran 50.000 - makan siang"';
    }
    return await prosesCatat(tipe, nominal, keterangan);
  }

  if (lower === 'hapus terakhir' || lower === 'hapus') {
    try {
      const data = await transaksiTerakhir(1);
      if (data.length === 0) return '📭 Belum ada transaksi tercatat.';
      const t = data[0];
      const emoji = t.tipe === 'masuk' ? '💰' : '💸';

      sesi.set(sender, { step: 'konfirmasi_hapus' });
      return `⚠️ Yakin mau hapus transaksi ini?\n\n${emoji} ${t.tanggal} - ${t.nama}: Rp${t.nominal.toLocaleString('id-ID')}\n\nBalas "ya" untuk hapus, atau apa saja untuk batal.`;
    } catch (err) {
      console.error(err.message);
      return '❌ Gagal ambil data dari spreadsheet.';
    }
  }

  if (lower === 'terakhir' || lower === 'riwayat') {
    try {
      const data = await transaksiTerakhir(5);
      if (data.length === 0) return '📭 Belum ada transaksi tercatat.';

      const list = data.map((t) => {
        const emoji = t.tipe === 'masuk' ? '💰' : '💸';
        return `${emoji} ${t.tanggal} - ${t.nama}: Rp${t.nominal.toLocaleString('id-ID')}`;
      }).join('\n');

      return `🕒 *5 Transaksi Terakhir*\n\n${list}`;
    } catch (err) {
      console.error(err.message);
      return '❌ Gagal ambil riwayat dari spreadsheet.';
    }
  }

  if (lower === 'rekap') {
    try {
      const { totalMasuk, totalKeluar, saldoAkhir } = await rekapBulanIni();
      return `📊 *Rekap Bulan Ini*\nPemasukan: Rp${totalMasuk.toLocaleString('id-ID')}\nPengeluaran: Rp${totalKeluar.toLocaleString('id-ID')}\nSaldo saat ini: Rp${saldoAkhir.toLocaleString('id-ID')}`;
    } catch (err) {
      console.error(err.message);
      return '❌ Gagal ambil rekap dari spreadsheet.';
    }
  }

  if (lower === 'help' || lower === 'bantuan') {
    return `📝 *Cara pakai bot:*\n\n` +
      `Cara 1 - Menu bertahap:\nketik: catat\n(lalu ikuti pilihannya)\n\n` +
      `Cara 2 - Shortcut satu baris:\nketik: pengeluaran <nominal> - <keterangan>\ncontoh: pengeluaran 50.000 - makan siang\n\n` +
      `Lihat rekap bulan ini:\nketik: rekap\n\n` +
      `Lihat 5 transaksi terakhir:\nketik: terakhir\n\n` +
      `Hapus transaksi terakhir:\nketik: hapus terakhir\n\n` +
      `Nominal bisa pakai titik ribuan (50.000) atau singkatan (5rb, 2jt)`;
  }

  return null;
}

startBot();