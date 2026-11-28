import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import QRCode from "qrcode";

dotenv.config({ path: ".env.local", quiet: true });
assert.equal(process.env.DB_NAME, "TDK_POS_TEST", "Development DB only");
const base = new URL(process.env.QR_TEST_HTTP_BASE_URL ?? "http://127.0.0.1:3000");
assert.ok(base.protocol === "http:" && ["127.0.0.1", "localhost"].includes(base.hostname), "Local HTTP only");
const response = await fetch(new URL("/api/db-test", base), { signal: AbortSignal.timeout(10000) });
assert.equal((await response.json()).result?.[0]?.database_name, "TDK_POS_TEST", "HTTP server must use TEST DB");

const connection = await mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: "TDK_POS_TEST",
});
const tag = "ZZISSUE" + randomBytes(5).toString("hex");
const hash = value => createHash("sha256").update(value).digest("hex");
const query = async (sql, params = []) => (await connection.execute(sql, params))[0];
const request = (path, { method = "GET", cookie, body } = {}) => fetch(new URL(path, base), {
  method, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(15000),
  headers: { ...(cookie ? { cookie } : {}), ...(body ? { origin: base.origin, "content-type": "application/json" } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});
const redirectPath = response => new URL(response.headers.get("location"), base).pathname;
const qrCookie = response => {
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  assert.match(cookie ?? "", /^tdkon_qr_session=/);
  return cookie;
};

const tables = [];
let staffId;
let trustId;
let adminSessionId;
try {
  assert.equal((await query("SELECT DATABASE() AS db"))[0].db, "TDK_POS_TEST");
  staffId = Number((await query("INSERT INTO staff (staff_code,name,role,is_active,admin_enabled) VALUES (?,?,'MANAGER',1,1)", [tag, tag])).insertId);
  const trust = randomBytes(32).toString("base64url");
  const session = "admin." + randomBytes(32).toString("base64url");
  trustId = Number((await query("INSERT INTO program_trust_tokens (program,token_hash,enrolled_by_staff_id) VALUES ('ADM',?,?)", [hash(trust), staffId])).insertId);
  adminSessionId = Number((await query("INSERT INTO staff_sessions (staff_id,trust_token_id,session_token_hash,session_type,status) VALUES (?,?,?,'ADMIN','ACTIVE')", [staffId, trustId, hash(session)])).insertId);
  const adminCookie = `tdk_admin_session=${session}; tdk_adm_trust_${trustId}=${trust}`;
  for (const suffix of ["A", "B"]) {
    const tableNo = tag + suffix;
    const tableId = Number((await query("INSERT INTO dining_tables (table_no,capacity,is_active) VALUES (?,4,1)", [tableNo])).insertId);
    tables.push({ tableId, tableNo });
  }

  const path = "/api/admin/qr-codes";
  const issue = await request(path, { cookie: adminCookie, method: "POST", body: { count: 2 } });
  assert.equal(issue.status, 201, "ADM issuance succeeds");
  assert.equal((await issue.json()).issued, 2);
  const codes = await query("SELECT qr_code_id,identifier,management_number,status,target_type FROM qr_codes WHERE created_by_staff_id=? ORDER BY qr_code_id", [staffId]);
  assert.equal(codes.length, 2);
  assert.notEqual(codes[0].identifier, codes[1].identifier);
  for (const [index, qr] of codes.entries()) {
    assert.match(qr.management_number, /^\d{8}-\d{4,}$/);
    assert.match(qr.identifier, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{16}$/);
    assert.equal(qr.status, "UNUSED");
    assert.equal(qr.target_type, "UNASSIGNED");
    const url = new URL(`https://tdkon.myasustor.com/tdkqrs/${qr.identifier}`);
    qr.path = url.pathname;
    const unused = await request(qr.path);
    assert.equal(redirectPath(unused), "/qrorder/unavailable");
    assert.equal(unused.headers.has("set-cookie"), false);
    const image = await request(`${path}/${qr.qr_code_id}/image`, { cookie: adminCookie });
    assert.equal(image.status, 200);
    assert.match(image.headers.get("content-type"), /^image\/svg\+xml/);
    const svg = await image.text();
    const svgOptions = { type: "svg", errorCorrectionLevel: "M", margin: 2, width: 320 };
    assert.ok(svg === await QRCode.toString(url.href, svgOptions), "served SVG encodes the exact case-sensitive ID and HTTPS path");
    assert.ok(svg !== await QRCode.toString(`${url.origin}/tdkqrs/${qr.management_number}`, svgOptions), "served SVG never encodes the ADM management number");

    const assign = await request(path, { cookie: adminCookie, method: "PATCH",
      body: { qrCodeId: Number(qr.qr_code_id), targetType: "TABLE_ORDER", tableId: tables[index].tableId } });
    assert.equal(assign.status, 200, "ADM table assignment succeeds");
  }
  const listing = await request(path, { cookie: adminCookie });
  assert.equal(listing.status, 200);
  const { codes: listed } = await listing.json();
  for (const [index, qr] of codes.entries()) {
    const item = listed.find(row => row.qrCodeId === Number(qr.qr_code_id));
    assert.equal(item?.status, "IN_USE");
    assert.equal(item?.tableId, tables[index].tableId);
    assert.equal(item?.tableNo, tables[index].tableNo);
  }

  const first = await request(codes[0].path);
  assert.equal(redirectPath(first), "/qrorder/order");
  const firstCookie = qrCookie(first);
  const legacy = await request(`/q/${codes[1].identifier}`);
  assert.equal(legacy.status, 307);
  assert.equal(redirectPath(legacy), codes[1].path);
  const scans = await Promise.all([request(codes[1].path, { cookie: firstCookie }), request(codes[1].path)]);
  const secondCookies = scans.map(scan => {
    assert.equal(redirectPath(scan), "/qrorder/order");
    return qrCookie(scan);
  });
  assert.equal(new Set([firstCookie, ...secondCookies]).size, 3);
  for (const [index, cookie] of [firstCookie, ...secondCookies].entries()) {
    const history = await request("/api/qr/table-orders", { cookie });
    assert.equal(history.status, 200);
    const payload = await history.json();
    assert.equal(payload.tableNo, tables[index === 0 ? 0 : 1].tableNo);
    assert.equal(payload.canViewOrders, false);
  }
  const [[missing]] = await connection.query("SELECT identifier FROM qr_codes WHERE identifier='23456789ABCDEFGH'");
  assert.equal(missing, undefined, "Missing-ID test must not touch a real sticker");
  assert.equal(redirectPath(await request("/tdkqrs/23456789ABCDEFGH", { cookie: firstCookie })), "/qrorder/unavailable");
  assert.equal(redirectPath(await request(`/tdkqrs/${codes[1].management_number}`)), "/qrorder/unavailable");
  const retire = await request(path, { cookie: adminCookie, method: "PATCH",
    body: { qrCodeId: Number(codes[0].qr_code_id), action: "RETIRE" } });
  assert.equal(retire.status, 200);
  const retired = await request(codes[0].path, { cookie: secondCookies[0] });
  assert.equal(redirectPath(retired), "/qrorder/unavailable");
  assert.equal(retired.headers.has("set-cookie"), false);
  console.log("PASS: ADM issuance, exact served SVG payload, assignment, active listing, legacy alias, fresh and switched scan, parallel sessions, retirement and invalid IDs");
} finally {
  try {
    await connection.beginTransaction();
    if (staffId !== undefined) {
      await query("DELETE FROM audit_logs WHERE entity_type='QR_CODE' AND (staff_id=? OR entity_id IN (SELECT qr_code_id FROM qr_codes WHERE created_by_staff_id=?))", [staffId, staffId]);
      await query("DELETE FROM qr_table_links WHERE qr_code_id IN (SELECT qr_code_id FROM qr_codes WHERE created_by_staff_id=?)", [staffId]);
      await query("DELETE FROM qr_codes WHERE created_by_staff_id=?", [staffId]);
    }
    for (const { tableId } of tables) {
      await query("DELETE FROM qr_sessions WHERE table_id=?", [tableId]);
      await query("DELETE FROM dining_tables WHERE table_id=?", [tableId]);
    }
    if (adminSessionId !== undefined) await query("DELETE FROM staff_sessions WHERE staff_session_id=?", [adminSessionId]);
    if (trustId !== undefined) await query("DELETE FROM program_trust_tokens WHERE token_id=?", [trustId]);
    if (staffId !== undefined) await query("DELETE FROM staff WHERE staff_id=? AND staff_code=?", [staffId, tag]);
    // Leave issued TEST serials consumed so parallel issuance cannot reuse a management number.
    await connection.commit();
    console.log("PASS: synthetic TEST rows removed; issued TEST serials remain reserved");
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
}
