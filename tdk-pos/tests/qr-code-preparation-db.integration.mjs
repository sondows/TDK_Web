import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });

const database = process.env.DB_NAME;
assert.equal(database, "TDK_POS_TEST", "Refusing to run unless DB_NAME is exactly TDK_POS_TEST");

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: "TDK_POS_TEST",
  multipleStatements: false,
  supportBigNumbers: true,
  bigNumberStrings: false,
});

const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function randomIdentifier() {
  return Array.from(randomBytes(16), byte => alphabet[byte % alphabet.length]).join("");
}

async function one(sql, params = []) {
  const [rows] = await connection.execute(sql, params);
  return rows[0] ?? null;
}

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function runConcurrencyChecks() {
  const other = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: "TDK_POS_TEST",
    multipleStatements: false,
    supportBigNumbers: true,
    bigNumberStrings: false,
  });
  let firstOpen = false;
  let secondOpen = false;
  let qrCodeId = null;
  let raceQrCodeId = null;
  let raceQrSessionId = null;
  let raceQrOrderId = null;
  let raceTokenHash = null;
  let tableId = null;
  const tag = randomBytes(6).toString("hex").toUpperCase();
  const identifier = randomIdentifier();
  const managementNumber = `ZZITC${tag}`;
  const temporaryTableNo = `ZZC${tag}`;

  try {
    tableId = Number((await connection.execute("INSERT INTO dining_tables (table_no,capacity,is_active) VALUES (?,8,1)", [temporaryTableNo]))[0].insertId);
    const safeTable = { table_id: tableId, table_no: temporaryTableNo };
    const testStaff = await one("SELECT staff_id FROM staff WHERE is_active = 1 AND staff_code <> '000' ORDER BY staff_id LIMIT 1");
    assert.ok(testStaff, "No active test staff row is available");

    const [resultA, resultB] = await Promise.all([
      connection.execute("SELECT DATABASE() AS db"),
      other.execute("SELECT DATABASE() AS db"),
    ]);
    assert.equal(resultA[0][0].db, "TDK_POS_TEST");
    assert.equal(resultB[0][0].db, "TDK_POS_TEST");

    // Concurrent preparation: connection B must wait on the same table lock,
    // then observe A's committed preparation instead of creating an orphan.
    await connection.beginTransaction();
    firstOpen = true;
    const lockedA = await one("SELECT table_id FROM dining_tables WHERE table_id = ? AND is_active = 1 FOR UPDATE", [tableId]);
    assert.ok(lockedA);
    await other.beginTransaction();
    secondOpen = true;
    let prepareLockSettled = false;
    let prepareLockError = null;
    const prepareLock = other.execute("SELECT table_id FROM dining_tables WHERE table_id = ? AND is_active = 1 FOR UPDATE", [tableId])
      .then(() => { prepareLockSettled = true; }, error => { prepareLockSettled = true; prepareLockError = error; });
    await pause(150);
    assert.equal(prepareLockSettled, false, "Second prepare did not wait on the table row lock");

    await connection.execute(
      "INSERT INTO qr_codes (identifier, management_number, target_type, status, created_by_staff_id, updated_by_staff_id) VALUES (?, ?, 'UNASSIGNED', 'UNUSED', ?, ?)",
      [identifier, managementNumber, testStaff.staff_id, testStaff.staff_id],
    );
    const inserted = await one("SELECT qr_code_id FROM qr_codes WHERE identifier = ?", [identifier]);
    qrCodeId = Number(inserted.qr_code_id);
    await connection.execute("INSERT INTO qr_code_preparations (qr_code_id, table_id, prepared_by_staff_id) VALUES (?, ?, ?)", [qrCodeId, tableId, testStaff.staff_id]);
    await connection.commit();
    firstOpen = false;
    await prepareLock;
    if (prepareLockError) throw prepareLockError;
    const visiblePreparation = await other.execute("SELECT qr_code_id FROM qr_code_preparations WHERE table_id = ? FOR UPDATE", [tableId]);
    assert.equal(Number(visiblePreparation[0][0]?.qr_code_id), qrCodeId, "Second prepare did not observe the winner's row");
    await other.rollback();
    secondOpen = false;

    // Concurrent activation: B waits on the QR lock. After A commits, B sees
    // the active state and deleted preparation, so a second activation cannot
    // create a second current link or duplicate audit row.
    await connection.beginTransaction();
    firstOpen = true;
    const qrLock = await one("SELECT qr_code_id, status, target_type FROM qr_codes WHERE qr_code_id = ? FOR UPDATE", [qrCodeId]);
    assert.equal(qrLock.status, "UNUSED");
    assert.equal(qrLock.target_type, "UNASSIGNED");
    const preparationLock = await one("SELECT table_id FROM qr_code_preparations WHERE qr_code_id = ? FOR UPDATE", [qrCodeId]);
    assert.equal(Number(preparationLock.table_id), tableId);
    const activationTable = await one("SELECT table_id FROM dining_tables WHERE table_id = ? AND is_active = 1 FOR UPDATE", [tableId]);
    assert.ok(activationTable);

    await other.beginTransaction();
    secondOpen = true;
    let activationLockSettled = false;
    let activationLockError = null;
    const activationLock = other.execute("SELECT qr_code_id, status, target_type FROM qr_codes WHERE qr_code_id = ? FOR UPDATE", [qrCodeId])
      .then(() => { activationLockSettled = true; }, error => { activationLockSettled = true; activationLockError = error; });
    await pause(150);
    assert.equal(activationLockSettled, false, "Second activation did not wait on the QR row lock");

    await connection.execute("INSERT INTO qr_table_links (qr_code_id, table_id, assigned_by_staff_id) VALUES (?, ?, ?)", [qrCodeId, tableId, testStaff.staff_id]);
    await connection.execute("UPDATE qr_codes SET target_type = 'TABLE_ORDER', status = 'IN_USE', updated_by_staff_id = ?, updated_at = NOW() WHERE qr_code_id = ?", [testStaff.staff_id, qrCodeId]);
    await connection.execute("DELETE FROM qr_code_preparations WHERE qr_code_id = ?", [qrCodeId]);
    await connection.execute("INSERT INTO audit_logs (staff_id, action_type, entity_type, entity_id, description) VALUES (?, 'QR_TABLE_ACTIVATE', 'QR_CODE', ?, ?)", [testStaff.staff_id, qrCodeId, `concurrency integration ${tag}`]);
    await connection.commit();
    firstOpen = false;

    await activationLock;
    if (activationLockError) throw activationLockError;
    const loserState = await one("SELECT status, target_type FROM qr_codes WHERE qr_code_id = ?", [qrCodeId]);
    const loserPreparation = await one("SELECT qr_code_id FROM qr_code_preparations WHERE qr_code_id = ?", [qrCodeId]);
    assert.equal(loserState.status, "IN_USE");
    assert.equal(loserState.target_type, "TABLE_ORDER");
    assert.equal(loserPreparation, null, "Second activation still sees a preparation");
    await other.rollback();
    secondOpen = false;

    const linkState = await one("SELECT COUNT(*) AS count, MIN(qr_code_id) AS qr_code_id FROM qr_table_links WHERE table_id = ?", [tableId]);
    assert.equal(Number(linkState.count), 1, "Concurrent activation created duplicate current links");
    assert.equal(Number(linkState.qr_code_id), qrCodeId);
    const auditState = await one("SELECT COUNT(*) AS count FROM audit_logs WHERE entity_id = ? AND action_type = 'QR_TABLE_ACTIVATE' AND description = ?", [qrCodeId, `concurrency integration ${tag}`]);
    assert.equal(Number(auditState.count), 1, "Concurrent activation duplicated audit records");

    // Order submission wins the shared table lock; activation must wait and
    // then observe the newly committed PENDING order and leave both QR states
    // untouched. This follows the order/activation table-lock ordering.
    const raceIdentifier = randomIdentifier();
    const raceManagementNumber = `ZZITP${tag}`;
    raceTokenHash = randomBytes(32).toString("hex");
    await connection.execute("INSERT INTO qr_codes (identifier, management_number, target_type, status, created_by_staff_id, updated_by_staff_id) VALUES (?, ?, 'UNASSIGNED', 'UNUSED', ?, ?)", [raceIdentifier, raceManagementNumber, testStaff.staff_id, testStaff.staff_id]);
    raceQrCodeId = Number((await one("SELECT qr_code_id FROM qr_codes WHERE identifier = ?", [raceIdentifier])).qr_code_id);
    await connection.execute("INSERT INTO qr_code_preparations (qr_code_id, table_id, prepared_by_staff_id) VALUES (?, ?, ?)", [raceQrCodeId, tableId, testStaff.staff_id]);

    await connection.beginTransaction();
    firstOpen = true;
    await one("SELECT table_id FROM dining_tables WHERE table_id = ? AND is_active = 1 FOR UPDATE", [tableId]);
    await connection.execute("INSERT INTO qr_sessions (session_id, table_id, token_hash, language_code, status) VALUES (NULL, ?, ?, 'ko', 'ACTIVE')", [tableId, raceTokenHash]);
    raceQrSessionId = Number((await one("SELECT qr_session_id FROM qr_sessions WHERE token_hash = ?", [raceTokenHash])).qr_session_id);

    await other.beginTransaction();
    secondOpen = true;
    await other.execute("SELECT qr_code_id FROM qr_codes WHERE qr_code_id = ? FOR UPDATE", [raceQrCodeId]);
    await other.execute("SELECT table_id FROM qr_code_preparations WHERE qr_code_id = ? FOR UPDATE", [raceQrCodeId]);
    let pendingActivationSettled = false;
    let pendingActivationError = null;
    const pendingActivationTable = other.execute("SELECT table_id FROM dining_tables WHERE table_id = ? AND is_active = 1 FOR UPDATE", [tableId])
      .then(() => { pendingActivationSettled = true; }, error => { pendingActivationSettled = true; pendingActivationError = error; });
    await pause(150);
    assert.equal(pendingActivationSettled, false, "Activation did not wait while QR order submission held the table lock");

    const [createdPending] = await connection.execute("INSERT INTO qr_orders (qr_session_id) VALUES (?)", [raceQrSessionId]);
    raceQrOrderId = Number(createdPending.insertId);
    await connection.commit();
    firstOpen = false;
    await pendingActivationTable;
    if (pendingActivationError) throw pendingActivationError;
    const pendingCount = await other.execute(`SELECT COUNT(*) AS count FROM qr_orders qo
      JOIN qr_sessions qs ON qs.qr_session_id = qo.qr_session_id
      LEFT JOIN table_sessions ts ON ts.session_id = qs.session_id
      WHERE qo.status = 'PENDING' AND COALESCE(ts.table_id, qs.table_id) = ?`, [tableId]);
    assert.equal(Number(pendingCount[0][0].count), 1, "Activation failed to observe the order committed while it waited");
    await other.rollback();
    secondOpen = false;
    const winnerAfterPending = await one("SELECT qr_code_id FROM qr_table_links WHERE table_id = ?", [tableId]);
    assert.equal(Number(winnerAfterPending.qr_code_id), qrCodeId, "Pending order race changed the current QR");
    const blockedPrepared = await one("SELECT status, target_type FROM qr_codes WHERE qr_code_id = ?", [raceQrCodeId]);
    assert.equal(blockedPrepared.status, "UNUSED");
    assert.equal(blockedPrepared.target_type, "UNASSIGNED");
    console.log(`PASS: order/activation lock race; the order committed first and activation observed PENDING without changing the current QR; table=${safeTable.table_no}.`);

    console.log(`PASS: separate-connection InnoDB contention; duplicate prepare serialized and second activation lost safely; table=${safeTable.table_no}.`);
  } finally {
    if (firstOpen) await connection.rollback().catch(() => {});
    if (secondOpen) await other.rollback().catch(() => {});
    if (qrCodeId !== null) {
      await connection.beginTransaction();
      try {
        if (raceQrOrderId !== null) await connection.execute("DELETE FROM qr_orders WHERE qr_order_id = ?", [raceQrOrderId]);
        if (raceQrSessionId !== null) await connection.execute("DELETE FROM qr_sessions WHERE qr_session_id = ? AND token_hash = ?", [raceQrSessionId, raceTokenHash]);
        if (raceQrCodeId !== null) {
          await connection.execute("DELETE FROM qr_table_links WHERE qr_code_id = ?", [raceQrCodeId]);
          await connection.execute("DELETE FROM qr_code_preparations WHERE qr_code_id = ?", [raceQrCodeId]);
          await connection.execute("DELETE FROM audit_logs WHERE entity_type = 'QR_CODE' AND entity_id = ?", [raceQrCodeId]);
          await connection.execute("DELETE FROM qr_codes WHERE qr_code_id = ?", [raceQrCodeId]);
        }
        await connection.execute("DELETE FROM qr_table_links WHERE qr_code_id = ?", [qrCodeId]);
        await connection.execute("DELETE FROM qr_code_preparations WHERE qr_code_id = ?", [qrCodeId]);
        await connection.execute("DELETE FROM audit_logs WHERE entity_type = 'QR_CODE' AND entity_id = ? AND description = ?", [qrCodeId, `concurrency integration ${tag}`]);
        await connection.execute("DELETE FROM qr_codes WHERE qr_code_id = ? AND identifier = ? AND management_number = ?", [qrCodeId, identifier, managementNumber]);
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    }
    if (tableId !== null) await connection.execute("DELETE FROM dining_tables WHERE table_id = ? AND table_no = ?", [tableId, temporaryTableNo]);
    await other.end();
  }

  const restored = await one(`SELECT
    (SELECT COUNT(*) FROM qr_table_links WHERE table_id = ?) AS links,
    (SELECT COUNT(*) FROM qr_code_preparations WHERE table_id = ?) AS preparations,
    (SELECT COUNT(*) FROM qr_codes WHERE management_number = ?) AS test_qrs`, [tableId, tableId, managementNumber]);
  assert.equal(Number(restored.links), 0, "Concurrent test did not restore the originally unlinked table");
  assert.equal(Number(restored.preparations), 0);
  assert.equal(Number(restored.test_qrs), 0);
}

async function runCustomerHttpChecks() {
  const configuredBase = process.env.QR_TEST_HTTP_BASE_URL;
  if (!configuredBase) {
    console.log("SKIP: customer QR HTTP checks (set QR_TEST_HTTP_BASE_URL to a local development server)");
    return;
  }
  const base = new URL(configuredBase);
  assert.equal(base.protocol, "http:", "HTTP integration checks only allow local plain-HTTP development servers");
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(base.hostname), "Remote hosts are not allowed in this TEST DB harness");
  const dbResponse = await fetch(new URL("/api/db-test", base), { cache: "no-store" });
  const dbBody = await dbResponse.json();
  assert.equal(dbResponse.status, 200);
  assert.equal(dbBody.result?.[0]?.database_name, "TDK_POS_TEST", "HTTP server is not connected to the test database");

  const denied = await fetch(new URL("/api/admin/qr-codes", base), { cache: "no-store", redirect: "manual" });
  assert.equal(denied.status, 403, "Anonymous ADM API request must be denied");
  const deniedBody = await denied.json();
  assert.equal(deniedBody.message, "ADM 사용 권한이 필요합니다.");
  const expiredCookie = `tdk_admin_session=admin.${randomBytes(32).toString("base64url")}`;
  const expired = await fetch(new URL("/api/admin/qr-codes", base), { headers: { cookie: expiredCookie }, cache: "no-store", redirect: "manual" });
  assert.equal(expired.status, 403, "Unknown/expired ADM session must be denied");

  const testStaff = await one("SELECT staff_id FROM staff WHERE is_active = 1 AND staff_code <> '000' ORDER BY staff_id LIMIT 1");
  assert.ok(testStaff);
  const runTag = randomBytes(6).toString("hex").toUpperCase();
  const temporaryTableNo = `ZZH${runTag}`;
  const safeTable = { table_id: Number((await connection.execute("INSERT INTO dining_tables (table_no,capacity,is_active) VALUES (?,8,1)", [temporaryTableNo]))[0].insertId), table_no: temporaryTableNo };
  const identifier = randomIdentifier();
  const managementNumber = `ZZI${runTag}`;
  let qrCodeId = null;
  let cookieTokenHash = null;

  try {
    await connection.execute(
      "INSERT INTO qr_codes (identifier, management_number, target_type, status, created_by_staff_id, updated_by_staff_id) VALUES (?, ?, 'UNASSIGNED', 'UNUSED', ?, ?)",
      [identifier, managementNumber, testStaff.staff_id, testStaff.staff_id],
    );
    const inserted = await one("SELECT qr_code_id FROM qr_codes WHERE identifier = ?", [identifier]);
    qrCodeId = Number(inserted.qr_code_id);
    await connection.execute("INSERT INTO qr_code_preparations (qr_code_id, table_id, prepared_by_staff_id) VALUES (?, ?, ?)", [qrCodeId, safeTable.table_id, testStaff.staff_id]);

    const preparedResponse = await fetch(new URL(`/tdkqrs/${identifier}`, base), { cache: "no-store", redirect: "manual" });
    const preparedLocation = preparedResponse.headers.get("location");
    assert.ok(preparedResponse.status >= 300 && preparedResponse.status < 400, "Prepared QR should redirect away from ordering");
    assert.equal(new URL(preparedLocation, base).pathname, "/qrorder/unavailable", "Prepared QR must be denied by the customer entry route");
    const sessionAfterPrepared = await one("SELECT COUNT(*) AS count FROM qr_sessions WHERE table_id = ? AND created_at >= NOW() - INTERVAL 2 MINUTE", [safeTable.table_id]);
    assert.equal(Number(sessionAfterPrepared.count), 0, "Prepared QR created a customer session");

    await connection.beginTransaction();
    try {
      await connection.execute("INSERT INTO qr_table_links (qr_code_id, table_id, assigned_by_staff_id) VALUES (?, ?, ?)", [qrCodeId, safeTable.table_id, testStaff.staff_id]);
      await connection.execute("UPDATE qr_codes SET target_type = 'TABLE_ORDER', status = 'IN_USE', updated_by_staff_id = ?, updated_at = NOW() WHERE qr_code_id = ?", [testStaff.staff_id, qrCodeId]);
      await connection.execute("DELETE FROM qr_code_preparations WHERE qr_code_id = ?", [qrCodeId]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }

    const activeResponse = await fetch(new URL(`/tdkqrs/${identifier}`, base), { cache: "no-store", redirect: "manual" });
    const cookieHeaders = typeof activeResponse.headers.getSetCookie === "function" ? activeResponse.headers.getSetCookie() : [activeResponse.headers.get("set-cookie")].filter(Boolean);
    const accessCookie = cookieHeaders.map(value => value.match(/(?:^|,\s*)tdkon_qr_session=([^;,]+)/)?.[1]).find(Boolean);
    if (accessCookie) cookieTokenHash = createHash("sha256").update(decodeURIComponent(accessCookie)).digest("hex");
    const activeLocation = activeResponse.headers.get("location");
    assert.ok(activeResponse.status >= 300 && activeResponse.status < 400, "Active test QR should issue a customer redirect");
    assert.equal(new URL(activeLocation, base).pathname, "/qrorder/order", "Active QR should enter the ordering screen for an unused test table");
    assert.ok(cookieTokenHash, "Active test QR did not issue a customer session cookie");
    const issuedSession = await one("SELECT status, table_id, session_id FROM qr_sessions WHERE token_hash = ?", [cookieTokenHash]);
    assert.ok(issuedSession, "Issued customer QR session was not stored");
    assert.equal(issuedSession.status, "ACTIVE");
    assert.equal(Number(issuedSession.table_id), Number(safeTable.table_id));
    assert.equal(issuedSession.session_id, null);

    console.log(`PASS: local customer QR HTTP route; prepared QR denied, active QR issued an isolated session; anonymous and unknown ADM cookies denied; table=${safeTable.table_no}.`);
  } finally {
    await connection.beginTransaction();
    try {
      await connection.execute("DELETE FROM qr_orders WHERE qr_session_id IN (SELECT qr_session_id FROM qr_sessions WHERE table_id = ?)", [safeTable.table_id]);
      await connection.execute("DELETE FROM qr_sessions WHERE table_id = ?", [safeTable.table_id]);
      if (qrCodeId !== null) {
        await connection.execute("DELETE FROM qr_table_links WHERE qr_code_id = ?", [qrCodeId]);
        await connection.execute("DELETE FROM qr_code_preparations WHERE qr_code_id = ?", [qrCodeId]);
        await connection.execute("DELETE FROM audit_logs WHERE entity_type = 'QR_CODE' AND entity_id = ?", [qrCodeId]);
        await connection.execute("DELETE FROM qr_codes WHERE qr_code_id = ? AND identifier = ? AND management_number = ?", [qrCodeId, identifier, managementNumber]);
      }
      await connection.execute("DELETE FROM dining_tables WHERE table_id = ? AND table_no = ?", [safeTable.table_id, temporaryTableNo]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  }
  const restored = await one(`SELECT
    (SELECT COUNT(*) FROM qr_table_links WHERE table_id = ?) AS links,
    (SELECT COUNT(*) FROM qr_code_preparations WHERE table_id = ?) AS preparations,
    (SELECT COUNT(*) FROM qr_codes WHERE management_number = ?) AS test_qrs,
    (SELECT COUNT(*) FROM qr_sessions WHERE token_hash = ?) AS test_sessions`, [safeTable.table_id, safeTable.table_id, managementNumber, cookieTokenHash ?? ""]);
  assert.equal(Number(restored.links), 0);
  assert.equal(Number(restored.preparations), 0);
  assert.equal(Number(restored.test_qrs), 0);
  assert.equal(Number(restored.test_sessions), 0);
}

async function run() {
  const current = await one("SELECT DATABASE() AS database_name");
  assert.equal(current.database_name, "TDK_POS_TEST", "Connected database mismatch; refusing writes");

  const table = await one(`
    SELECT t.table_id, t.table_no, l.qr_code_id AS old_qr_code_id, q.status AS old_status,
           q.target_type AS old_target_type, s.session_id
      FROM dining_tables t
      JOIN qr_table_links l ON l.table_id = t.table_id
      JOIN qr_codes q ON q.qr_code_id = l.qr_code_id
      LEFT JOIN table_sessions s ON s.table_id = t.table_id AND s.status = 'OPEN' AND s.session_kind = 'DINE_IN'
     WHERE t.is_active = 1 AND q.status = 'IN_USE' AND q.target_type = 'TABLE_ORDER'
       AND NOT EXISTS (SELECT 1 FROM qr_code_preparations p WHERE p.table_id = t.table_id)
     ORDER BY t.sort_order, t.table_no LIMIT 1`);
  assert.ok(table, "No active linked QR table without an existing preparation; no test data written");
  assert.ok(table.session_id, "No open table session available to verify preservation of an already-bound customer; no test data written");
  const staff = await one("SELECT staff_id FROM staff WHERE is_active = 1 AND staff_code <> '000' ORDER BY staff_id LIMIT 1");
  assert.ok(staff, "No active test staff row; no test data written");

  const runTag = randomBytes(6).toString("hex").toUpperCase();
  const identifier = randomIdentifier();
  const managementNumber = `IT${runTag}`;
  let transactionOpen = false;

  try {
    await connection.beginTransaction();
    transactionOpen = true;

    const lockedTable = await one("SELECT table_id FROM dining_tables WHERE table_id = ? AND is_active = 1 FOR UPDATE", [table.table_id]);
    assert.ok(lockedTable, "Target table is no longer active");
    const beforeLink = await one("SELECT qr_code_id FROM qr_table_links WHERE table_id = ? FOR UPDATE", [table.table_id]);
    assert.equal(Number(beforeLink?.qr_code_id), Number(table.old_qr_code_id), "Existing QR link changed before test");

    await connection.execute(
      "INSERT INTO qr_codes (identifier, management_number, target_type, status, created_by_staff_id, updated_by_staff_id) VALUES (?, ?, 'UNASSIGNED', 'UNUSED', ?, ?)",
      [identifier, managementNumber, staff.staff_id, staff.staff_id],
    );
    const preparedQr = await one("SELECT qr_code_id, status, target_type FROM qr_codes WHERE identifier = ?", [identifier]);
    assert.ok(preparedQr, "Prepared QR insert failed");
    await connection.execute(
      "INSERT INTO qr_code_preparations (qr_code_id, table_id, prepared_by_staff_id) VALUES (?, ?, ?)",
      [preparedQr.qr_code_id, table.table_id, staff.staff_id],
    );

    const preparedState = await one(`
      SELECT q.status, q.target_type, l.qr_code_id AS linked_qr_code_id, p.table_id
        FROM qr_codes q LEFT JOIN qr_table_links l ON l.qr_code_id = q.qr_code_id
        LEFT JOIN qr_code_preparations p ON p.qr_code_id = q.qr_code_id
       WHERE q.qr_code_id = ?`, [preparedQr.qr_code_id]);
    assert.equal(preparedState.status, "UNUSED");
    assert.equal(preparedState.target_type, "UNASSIGNED");
    assert.equal(preparedState.linked_qr_code_id, null, "Prepared QR must not be active-linked");
    assert.equal(Number(preparedState.table_id), Number(table.table_id));
    const linkBeforeActivation = await one("SELECT qr_code_id FROM qr_table_links WHERE table_id = ?", [table.table_id]);
    assert.equal(Number(linkBeforeActivation.qr_code_id), Number(table.old_qr_code_id), "Preparing a QR replaced the active QR");

    await connection.execute("SAVEPOINT duplicate_preparation");
    const duplicateId = randomIdentifier();
    await connection.execute(
      "INSERT INTO qr_codes (identifier, management_number, target_type, status, created_by_staff_id, updated_by_staff_id) VALUES (?, ?, 'UNASSIGNED', 'UNUSED', ?, ?)",
      [duplicateId, `IT${runTag}D`, staff.staff_id, staff.staff_id],
    );
    const duplicateQr = await one("SELECT qr_code_id FROM qr_codes WHERE identifier = ?", [duplicateId]);
    await assert.rejects(
      connection.execute("INSERT INTO qr_code_preparations (qr_code_id, table_id, prepared_by_staff_id) VALUES (?, ?, ?)", [duplicateQr.qr_code_id, table.table_id, staff.staff_id]),
      error => error.code === "ER_DUP_ENTRY",
    );
    await connection.query("ROLLBACK TO SAVEPOINT duplicate_preparation");
    const prepCount = await one("SELECT COUNT(*) AS count FROM qr_code_preparations WHERE table_id = ?", [table.table_id]);
    assert.equal(Number(prepCount.count), 1, "Unique table preparation constraint did not hold");

    const boundTokenHash = randomBytes(32).toString("hex");
    const unboundTokenHash = randomBytes(32).toString("hex");
    const pendingTokenHash = randomBytes(32).toString("hex");
    const openSession = table.session_id == null ? null : Number(table.session_id);
    await connection.execute(
      "INSERT INTO qr_sessions (session_id, table_id, token_hash, language_code, status) VALUES (?, ?, ?, 'ko', 'ACTIVE')",
      [openSession, table.table_id, boundTokenHash],
    );
    const boundQrSession = await one("SELECT qr_session_id, status, session_id FROM qr_sessions WHERE token_hash = ?", [boundTokenHash]);
    await connection.execute(
      "INSERT INTO qr_sessions (session_id, table_id, token_hash, language_code, status) VALUES (NULL, ?, ?, 'ko', 'ACTIVE')",
      [table.table_id, unboundTokenHash],
    );
    const unboundQrSession = await one("SELECT qr_session_id FROM qr_sessions WHERE token_hash = ?", [unboundTokenHash]);
    await connection.execute(
      "INSERT INTO qr_sessions (session_id, table_id, token_hash, language_code, status) VALUES (?, ?, ?, 'ko', 'ACTIVE')",
      [openSession, table.table_id, pendingTokenHash],
    );
    const pendingQrSession = await one("SELECT qr_session_id FROM qr_sessions WHERE token_hash = ?", [pendingTokenHash]);
    await connection.execute("INSERT INTO qr_orders (qr_session_id) VALUES (?)", [pendingQrSession.qr_session_id]);
    const [pendingRows] = await connection.execute(`
      SELECT COUNT(*) AS count FROM qr_orders qo JOIN qr_sessions qs ON qs.qr_session_id = qo.qr_session_id
      LEFT JOIN table_sessions ts ON ts.session_id = qs.session_id
      WHERE qo.status = 'PENDING' AND COALESCE(ts.table_id, qs.table_id) = ?`, [table.table_id]);
    assert.equal(Number(pendingRows[0].count), 1, "Pending QR order guard fixture was not found");
    assert.equal(preparedState.status, "UNUSED", "Pending order check must not mutate QR state");
    await connection.execute("DELETE FROM qr_orders WHERE qr_session_id = ? AND status = 'PENDING'", [pendingQrSession.qr_session_id]);

    const [pendingAfterRemoval] = await connection.execute(`
      SELECT COUNT(*) AS count FROM qr_orders qo JOIN qr_sessions qs ON qs.qr_session_id = qo.qr_session_id
      LEFT JOIN table_sessions ts ON ts.session_id = qs.session_id
      WHERE qo.status = 'PENDING' AND COALESCE(ts.table_id, qs.table_id) = ?`, [table.table_id]);
    assert.equal(Number(pendingAfterRemoval[0].count), 0, "Could not isolate the test pending-order fixture");

    const oldQr = await one("SELECT qr_code_id FROM qr_codes WHERE qr_code_id = ? FOR UPDATE", [table.old_qr_code_id]);
    assert.ok(oldQr, "Current QR disappeared");
    const prep = await one("SELECT table_id FROM qr_code_preparations WHERE qr_code_id = ? FOR UPDATE", [preparedQr.qr_code_id]);
    assert.equal(Number(prep?.table_id), Number(table.table_id));
    await one("SELECT table_id FROM dining_tables WHERE table_id = ? AND is_active = 1 FOR UPDATE", [table.table_id]);
    const pendingCheck = await one(`
      SELECT COUNT(*) AS count FROM qr_orders qo JOIN qr_sessions qs ON qs.qr_session_id = qo.qr_session_id
      LEFT JOIN table_sessions ts ON ts.session_id = qs.session_id
      WHERE qo.status = 'PENDING' AND COALESCE(ts.table_id, qs.table_id) = ?`, [table.table_id]);
    assert.equal(Number(pendingCheck.count), 0, "Activation must stop while a pending QR order exists");

    await connection.execute("DELETE FROM qr_table_links WHERE qr_code_id = ?", [table.old_qr_code_id]);
    await connection.execute("UPDATE qr_codes SET target_type = 'UNASSIGNED', status = 'RETIRED', updated_by_staff_id = ?, updated_at = NOW() WHERE qr_code_id = ?", [staff.staff_id, table.old_qr_code_id]);
    await connection.execute("UPDATE qr_sessions SET status = 'CLOSED', closed_at = NOW() WHERE table_id = ? AND session_id IS NULL AND status = 'ACTIVE'", [table.table_id]);
    await connection.execute("INSERT INTO qr_table_links (qr_code_id, table_id, assigned_by_staff_id) VALUES (?, ?, ?)", [preparedQr.qr_code_id, table.table_id, staff.staff_id]);
    await connection.execute("UPDATE qr_codes SET target_type = 'TABLE_ORDER', status = 'IN_USE', updated_by_staff_id = ?, updated_at = NOW() WHERE qr_code_id = ?", [staff.staff_id, preparedQr.qr_code_id]);
    await connection.execute("DELETE FROM qr_code_preparations WHERE qr_code_id = ?", [preparedQr.qr_code_id]);
    await connection.execute("INSERT INTO audit_logs (staff_id, action_type, entity_type, entity_id, description) VALUES (?, 'QR_TABLE_ACTIVATE', 'QR_CODE', ?, ?)", [staff.staff_id, preparedQr.qr_code_id, `integration test ${runTag}`]);

    const active = await one(`SELECT q.status, q.target_type, l.table_id FROM qr_codes q
      JOIN qr_table_links l ON l.qr_code_id = q.qr_code_id WHERE q.qr_code_id = ?`, [preparedQr.qr_code_id]);
    assert.equal(active.status, "IN_USE");
    assert.equal(active.target_type, "TABLE_ORDER");
    assert.equal(Number(active.table_id), Number(table.table_id));
    const retired = await one("SELECT status, target_type FROM qr_codes WHERE qr_code_id = ?", [table.old_qr_code_id]);
    assert.equal(retired.status, "RETIRED");
    assert.equal(retired.target_type, "UNASSIGNED");
    const prepAfter = await one("SELECT COUNT(*) AS count FROM qr_code_preparations WHERE qr_code_id = ?", [preparedQr.qr_code_id]);
    assert.equal(Number(prepAfter.count), 0);
    const linkCount = await one("SELECT COUNT(*) AS count FROM qr_table_links WHERE table_id = ?", [table.table_id]);
    assert.equal(Number(linkCount.count), 1);
    const boundAfter = await one("SELECT status, session_id FROM qr_sessions WHERE qr_session_id = ?", [boundQrSession.qr_session_id]);
    assert.equal(boundAfter.status, "ACTIVE", "Bound customer session must survive replacement");
    assert.equal(Number(boundAfter.session_id), openSession);
    const unboundAfter = await one("SELECT status, session_id FROM qr_sessions WHERE qr_session_id = ?", [unboundQrSession.qr_session_id]);
    assert.equal(unboundAfter.status, "CLOSED", "Unbound customer session must be revoked on replacement");
    assert.equal(unboundAfter.session_id, null);

    await connection.rollback();
    transactionOpen = false;

    const restoredLink = await one("SELECT qr_code_id FROM qr_table_links WHERE table_id = ?", [table.table_id]);
    assert.equal(Number(restoredLink?.qr_code_id), Number(table.old_qr_code_id), "Rollback did not restore the original QR link");
    const restoredOldQr = await one("SELECT status, target_type FROM qr_codes WHERE qr_code_id = ?", [table.old_qr_code_id]);
    assert.equal(restoredOldQr.status, table.old_status);
    assert.equal(restoredOldQr.target_type, table.old_target_type);
    const residualQr = await one("SELECT COUNT(*) AS count FROM qr_codes WHERE management_number = ?", [managementNumber]);
    assert.equal(Number(residualQr.count), 0, "Test QR fixture remained after rollback");

    console.log(`PASS: TEST DB transactional prepare/activation and rollback; table=${table.table_no}; prepared QR remained isolated, duplicate prep rejected, pending order detected, prior link restored, bound customer kept, unbound session closed (inside transaction).`);
    console.log("NOTE: DB transactions exercise SQL semantics directly. Local HTTP checks separately cover customer entry and ADM denial; valid ADM success still requires a real trusted staff session.");
    await runConcurrencyChecks();
    await runCustomerHttpChecks();
  } finally {
    if (transactionOpen) await connection.rollback();
  }
}

try {
  await run();
} finally {
  await connection.end();
}
