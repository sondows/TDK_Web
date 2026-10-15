// One-off archive import. Writes only to legacy_daily_sales in the explicitly selected database.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const project = path.resolve(__dirname, '..');
const defaultMdb = path.resolve(project, '..', '이전자료_261002', 'Hotkimchi_261002자료_PWx.mdb');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const doImport = args.includes('--import');
const all = args.includes('--all');
const dateArg = args.find(arg => arg.startsWith('--date='));
const mdbArg = args.find(arg => arg.startsWith('--mdb='));
const businessDate = dateArg?.slice('--date='.length);
const mdbPath = mdbArg ? path.resolve(mdbArg.slice('--mdb='.length)) : defaultMdb;
const columns = ['sale_count', 'gross_sales', 'discount_amount', 'net_sales', 'card_amount', 'cash_amount', 'bank_transfer_amount', 'other_amount', 'cancelled_count', 'cancelled_amount'];

function usage() {
  throw new Error('Usage: node scripts/import-legacy-daily-sales.cjs --dry-run [--date=YYYY-MM-DD] [--mdb=PATH] | --import --date=YYYY-MM-DD [--mdb=PATH] | --import --all [--mdb=PATH]');
}
if (dryRun === doImport || (doImport && Boolean(businessDate) === all) || (businessDate && !/^\d{4}-\d{2}-\d{2}$/.test(businessDate))) usage();
if (!fs.existsSync(mdbPath)) throw new Error(`MDB not found: ${mdbPath}`);

const originalHash = crypto.createHash('sha256').update(fs.readFileSync(mdbPath)).digest('hex');
const powerShell = process.env.LEGACY_ACCESS_POWERSHELL || 'C:\\Windows\\SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe';
const output = execFileSync(powerShell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'read-legacy-daily-sales.ps1'), '-MdbPath', mdbPath], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const archive = JSON.parse(output.replace(/^\uFEFF/, ''));
const hashAfter = crypto.createHash('sha256').update(fs.readFileSync(mdbPath)).digest('hex');
if (originalHash !== hashAfter) throw new Error('MDB hash changed during read');
if (archive.unmatched_payment_count) throw new Error(`${archive.unmatched_payment_count} payment rows have no SaleCode match`);

const totals = archive.days.reduce((sum, day) => {
  for (const name of columns) sum[name] = (sum[name] || 0) + day[name];
  return sum;
}, {});
const latest = archive.days.find(day => day.business_date === '2026-10-02');
const expectedLatest = { sale_count: 23, net_sales: 679500, card_amount: 639500, cash_amount: 26000, bank_transfer_amount: 14000, discount_amount: 0, cancelled_count: 0 };
if (!latest || Object.entries(expectedLatest).some(([key, value]) => latest[key] !== value)) throw new Error(`2026-10-02 source validation failed: ${JSON.stringify(latest)}`);

const selected = businessDate ? archive.days.filter(day => day.business_date === businessDate) : archive.days;
if (!selected.length) throw new Error(`No Sale data for ${businessDate}`);
const report = { source: 'LEGACY_POS', mdb_sha256: originalHash, period: [archive.days[0].business_date, archive.days.at(-1).business_date], business_days: archive.days.length, totals, latest_day: latest, selected_days: selected.length, cross_date_groups: archive.cross_date_group_count, unmatched_payments: archive.unmatched_payment_count };
if (dryRun) {
  console.log(JSON.stringify({ ...report, selected: businessDate ? selected : undefined, payment_types: archive.payment_types }, null, 2));
  process.exit(0);
}

// dotenv must not print credentials. The development database stays on TEST;
// production import requires a separate, process-scoped target setting.
require('dotenv').config({ path: path.join(project, '.env.local'), quiet: true });
if (process.env.DB_NAME !== 'TDK_POS_TEST') throw new Error('Development DB_NAME must remain TDK_POS_TEST');
const targetDbName = process.env.LEGACY_IMPORT_DB_NAME || process.env.DB_NAME;
if (!['TDK_POS_TEST', 'TDK_POS'].includes(targetDbName)) throw new Error(`Unsupported legacy import database: ${targetDbName}`);
const productionImport = targetDbName === 'TDK_POS';
const mysql = require('mysql2/promise');

function sameRow(existing, day) {
  return existing.source === 'LEGACY_POS' && columns.every(name => Number(existing[name]) === day[name]);
}
async function main() {
  const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: targetDbName, connectTimeout: 10000 });
  try {
    const [[{ db_name: dbName }]] = await db.query('SELECT DATABASE() AS db_name');
    if (dbName !== targetDbName) throw new Error(`Unexpected database: ${dbName}`);
    await db.beginTransaction();
    if (productionImport) {
      const [[{ first_completed: firstCompleted }]] = await db.query("SELECT DATE_FORMAT(MIN(completed_at), '%Y-%m-%d') AS first_completed FROM checkouts");
      if (firstCompleted && firstCompleted <= archive.days.at(-1).business_date)
        throw new Error(`Production checkout history overlaps the MDB period: ${firstCompleted}`);
    }
    if (all) {
      const [verified] = await db.query('SELECT * FROM legacy_daily_sales WHERE business_date = ?', ['2026-10-02']);
      if (!productionImport && (verified.length !== 1 || !sameRow(verified[0], latest))) throw new Error('Import 2026-10-02 and verify it in TDK_POS_TEST before --all');
    }
    let inserted = 0, alreadyPresent = 0;
    for (const day of selected) {
      const [existing] = await db.query('SELECT * FROM legacy_daily_sales WHERE business_date = ? FOR UPDATE', [day.business_date]);
      if (existing.length) {
        if (!sameRow(existing[0], day)) throw new Error(`Existing archive row differs at ${day.business_date}; no overwrite performed`);
        alreadyPresent++;
        continue;
      }
      await db.query(`INSERT INTO legacy_daily_sales (business_date, ${columns.join(', ')}, source) VALUES (${Array(columns.length + 2).fill('?').join(', ')})`, [day.business_date, ...columns.map(name => day[name]), 'LEGACY_POS']);
      inserted++;
    }
    const [validated] = await db.query('SELECT * FROM legacy_daily_sales WHERE business_date = ?', ['2026-10-02']);
    if (validated.length !== 1 || !sameRow(validated[0], latest)) throw new Error('2026-10-02 database verification failed');
    if (all) {
      const [[actual]] = await db.query(`SELECT COUNT(*) AS days, ${columns.map(name => `COALESCE(SUM(${name}), 0) AS ${name}`).join(', ')} FROM legacy_daily_sales WHERE source = 'LEGACY_POS'`);
      if (Number(actual.days) !== archive.days.length || columns.some(name => Number(actual[name]) !== totals[name]))
        throw new Error(`Full archive total mismatch before commit: ${JSON.stringify(actual)}`);
    }
    await db.commit();
    console.log(JSON.stringify({ database: dbName, inserted, already_present: alreadyPresent, latest_day_verified: latest, business_days_in_source: archive.days.length, expected_full_net_sales: totals.net_sales }, null, 2));
  } catch (error) {
    await db.rollback();
    throw error;
  } finally { await db.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
