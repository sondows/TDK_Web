// Deliberately restricted to the TEST database.
const fs = require('node:fs');
const path = require('node:path');
const project = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(project, '.env.local'), quiet: true });
if (process.env.DB_NAME !== 'TDK_POS_TEST') throw new Error('Migration is restricted to DB_NAME=TDK_POS_TEST');
const mysql = require('mysql2/promise');

async function main() {
  const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectTimeout: 10000 });
  try {
    const [[{ db_name: dbName }]] = await db.query('SELECT DATABASE() AS db_name');
    if (dbName !== 'TDK_POS_TEST') throw new Error(`Unexpected database: ${dbName}`);
    const ddl = fs.readFileSync(path.join(project, 'db-migrations', '20261014_legacy_daily_sales.sql'), 'utf8')
      .split('\n').filter(line => !line.trim().startsWith('--')).join('\n').trim();
    await db.query(ddl);
    const [columns] = await db.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'legacy_daily_sales' ORDER BY ORDINAL_POSITION");
    console.log(JSON.stringify({ database: dbName, table: 'legacy_daily_sales', columns: columns.map(row => row.COLUMN_NAME) }, null, 2));
  } finally { await db.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
