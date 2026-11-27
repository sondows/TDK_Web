import assert from "node:assert/strict";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ path: ".env.local", quiet: true });
assert.equal(process.env.DB_NAME, "TDK_POS_TEST", "Refusing to run unless the application DB is TDK_POS_TEST");

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: "TDK_POS_TEST",
  multipleStatements: false,
});
const [{ readTvQrAuthCodeStatus, issueTestTvQrAuthCode }, { pool }] = await Promise.all([
  import("../src/lib/tdktv-qr-auth-code.ts"),
  import("../src/db/index.ts"),
]);

try {
  const [[database]] = await connection.query("SELECT DATABASE() AS name");
  assert.equal(database.name, "TDK_POS_TEST");
  const initial = await readTvQrAuthCodeStatus();
  const [[initialRow]] = await connection.query("SELECT issuance_id, code, state_version FROM tv_qr_auth_code_state WHERE state_id = 1");
  assert.equal(initial.code, null, "Refusing to disturb an existing verification display");
  assert.equal(initialRow?.issuance_id, null, "Refusing to overwrite a saved issuance");
  assert.equal(initialRow?.code, null, "Refusing to overwrite a saved code");
  assert.equal(Number(initialRow?.state_version ?? 0), 0, "Refusing to overwrite an existing test history");

  try {
    const first = await issueTestTvQrAuthCode();
    assert.match(first.code ?? "", /^\d{2}$/);
    assert.ok(first.issuanceId);
    const firstVersion = Number(first.stateVersion);
    const readA = await readTvQrAuthCodeStatus();
    await new Promise(resolve => setTimeout(resolve, 30));
    const readB = await readTvQrAuthCodeStatus();
    assert.equal(readB.stateVersion, readA.stateVersion, "Status reads must not update state version");
    assert.equal(readB.expiresAtMs, readA.expiresAtMs, "Status reads must not extend expiry");

    const concurrent = await Promise.all([issueTestTvQrAuthCode(), issueTestTvQrAuthCode()]);
    assert.ok(concurrent.every(result => result.code === first.code && result.issuanceId === first.issuanceId),
      "Concurrent issuers must share the active code and issuance");
    const activeAfterConcurrency = await readTvQrAuthCodeStatus();
    assert.equal(Number(activeAfterConcurrency.stateVersion), firstVersion + 2);
    assert.ok((activeAfterConcurrency.expiresAtMs ?? 0) >= (readB.expiresAtMs ?? 0));

    await connection.query("UPDATE tv_qr_auth_code_state SET expires_at = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE state_id = 1");
    assert.equal((await readTvQrAuthCodeStatus()).code, null, "Expired codes must not be returned by status reads");
    const next = await issueTestTvQrAuthCode();
    assert.notEqual(next.issuanceId, first.issuanceId, "After expiry, the next issue must create a new issuance");
    assert.equal(Number(next.stateVersion), firstVersion + 3);
    console.log("TDK_POS_TEST TV auth-code integration: shared issue, read-only status, concurrency, expiry, new issuance PASS");
  } finally {
    await connection.query(`UPDATE tv_qr_auth_code_state SET issuance_id = NULL, code = NULL,
      issued_at = NULL, last_requested_at = NULL, expires_at = NULL, state_version = 0,
      updated_at = CURRENT_TIMESTAMP(3) WHERE state_id = 1`);
  }
} finally {
  await connection.end();
  await pool.end();
}
