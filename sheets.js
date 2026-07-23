import { google } from 'googleapis';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = process.env.SHEET_NAME || 'Sheet1';

const auth = new google.auth.GoogleAuth({
  keyFile: path.join(__dirname, 'credentials.json'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheetsApi = google.sheets({ version: 'v4', auth });

let cachedSheetId = null;

function formatTanggal(date) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}-${m}-${y}`;
}

async function getAllRows() {
  const res = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A2:F`,
  });
  return res.data.values || [];
}

async function getSheetId() {
  if (cachedSheetId !== null) return cachedSheetId;
  const res = await sheetsApi.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheet = res.data.sheets.find((s) => s.properties.title === SHEET_NAME);
  if (!sheet) throw new Error(`Sheet dengan nama "${SHEET_NAME}" tidak ditemukan`);
  cachedSheetId = sheet.properties.sheetId;
  return cachedSheetId;
}

export async function catatTransaksi(tipe, nominal, keterangan) {
  const rows = await getAllRows();
  const nextNo = rows.length + 1;
  const lastTotal = rows.length > 0 ? parseFloat(rows[rows.length - 1][5]) || 0 : 0;
  const newTotal = tipe === 'masuk' ? lastTotal + nominal : lastTotal - nominal;

  const kolomPengeluaran = tipe === 'keluar' ? nominal : '';
  const kolomPemasukan = tipe === 'masuk' ? nominal : '';
  const tanggal = formatTanggal(new Date());

  await sheetsApi.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:F`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[nextNo, tanggal, keterangan, kolomPengeluaran, kolomPemasukan, newTotal]],
    },
  });

  return { newTotal };
}

export async function rekapBulanIni() {
  const rows = await getAllRows();
  const now = new Date();
  const bulanIni = now.getMonth();
  const tahunIni = now.getFullYear();

  let totalMasuk = 0;
  let totalKeluar = 0;

  for (const row of rows) {
    const tanggalStr = row[1];
    if (!tanggalStr) continue;
    const [d, m, y] = tanggalStr.split('-').map(Number);
    if (m - 1 !== bulanIni || y !== tahunIni) continue;

    totalKeluar += parseFloat(row[3]) || 0;
    totalMasuk += parseFloat(row[4]) || 0;
  }

  const saldoAkhir = rows.length > 0 ? parseFloat(rows[rows.length - 1][5]) || 0 : 0;

  return { totalMasuk, totalKeluar, saldoAkhir };
}

export async function transaksiTerakhir(jumlah = 5) {
  const rows = await getAllRows();
  const terakhir = rows.slice(-jumlah).reverse();

  return terakhir.map((row) => {
    const isKeluar = row[3] !== '' && row[3] !== undefined;
    return {
      tanggal: row[1],
      nama: row[2],
      tipe: isKeluar ? 'keluar' : 'masuk',
      nominal: isKeluar ? (parseFloat(row[3]) || 0) : (parseFloat(row[4]) || 0),
    };
  });
}

export async function hapusTerakhir() {
  const rows = await getAllRows();
  if (rows.length === 0) return null;

  const rowTerakhir = rows[rows.length - 1];
  const sheetId = await getSheetId();

  const startIndex = rows.length;
  const endIndex = rows.length + 1;

  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: { sheetId, dimension: 'ROWS', startIndex, endIndex },
          },
        },
      ],
    },
  });

  const isKeluar = rowTerakhir[3] !== '' && rowTerakhir[3] !== undefined;
  return {
    nama: rowTerakhir[2],
    tipe: isKeluar ? 'keluar' : 'masuk',
    nominal: isKeluar ? (parseFloat(rowTerakhir[3]) || 0) : (parseFloat(rowTerakhir[4]) || 0),
  };
}