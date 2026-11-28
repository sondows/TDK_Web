import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool } from "@/db";
import { getQrOrderAuthApiError, resolveQrOrderRequest } from "@/lib/qr-order-auth";
import { isSameOriginQrRequest } from "@/lib/qr-visit-session";
import { nextQrOrderAuthFailure, validQrOrderAuthCode } from "@/lib/qr-order-auth-attempt-policy";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const uuidPattern = /^[0-9a-f-]{36}$/i;
const rowTimestamp = (value: unknown) => value === null || value === undefined ? null : Number(value);

async function lockAndValidateCustomer(connection: PoolConnection, member: NonNullable<Awaited<ReturnType<typeof resolveQrOrderRequest>>>) {
  const [tables] = await connection.query<RowDataPacket[]>("SELECT table_id FROM dining_tables WHERE table_id=? AND is_active=1 FOR UPDATE", [member.tableId]);
  if (!tables.length) return false;
  const [sessions] = await connection.query<RowDataPacket[]>(`SELECT table_id AS tableId,session_id AS sessionId,status
    FROM qr_sessions WHERE qr_session_id=? FOR UPDATE`, [member.qrSessionId]);
  const session = sessions[0];
  if (!session || session.status !== "ACTIVE" || Number(session.tableId) !== member.tableId ||
    (session.sessionId !== null && Number(session.sessionId) !== member.sessionId)) return false;
  if (session.sessionId !== null) {
    const [visits] = await connection.query<RowDataPacket[]>(`SELECT session_id FROM table_sessions
      WHERE session_id=? AND table_id=? AND status='OPEN' AND session_kind='DINE_IN' FOR UPDATE`, [session.sessionId, member.tableId]);
    if (!visits.length) return false;
  }
  const [codes] = await connection.query<RowDataPacket[]>(`SELECT code.qr_code_id FROM qr_table_links link
    INNER JOIN qr_codes code ON code.qr_code_id=link.qr_code_id
    WHERE link.table_id=? AND code.status='IN_USE' AND code.target_type='TABLE_ORDER' LIMIT 1`, [member.tableId]);
  return codes.length > 0;
}

export async function POST(request: Request) {
  if (!isSameOriginQrRequest(request)) return Response.json({ success: false }, { status: 403, headers });
  const unavailable = await getQrOrderAuthApiError();
  if (unavailable) return unavailable;
  const member = await resolveQrOrderRequest(request);
  if (!member) return Response.json({ success: false, message: "테이블 QR 인증이 만료되었습니다. QR을 다시 스캔해 주세요." }, { status: 401, headers });
  const body = await request.json().catch(() => null) as { attemptId?: unknown; code?: unknown } | null;
  if (!body || typeof body.attemptId !== "string" || !uuidPattern.test(body.attemptId) || !validQrOrderAuthCode(body.code)) {
    return Response.json({ success: false, message: "인증번호 두 자리를 입력해 주세요." }, { status: 400, headers });
  }

  let connection: PoolConnection | null = null;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    if (!await lockAndValidateCustomer(connection, member)) {
      await connection.rollback();
      return Response.json({ success: false, message: "고객 세션이 만료되었거나 테이블 QR이 변경되었습니다." }, { status: 409, headers });
    }
    const [notice] = await connection.query<RowDataPacket[]>("SELECT is_active AS isActive FROM tv_business_notice WHERE notice_id=1 FOR UPDATE");
    if (Number(notice[0]?.isActive ?? 0) === 1) {
      await connection.rollback();
      return Response.json({ success: false, code: "TV_NOTICE_ACTIVE", message: "매장 안내가 표시 중이라 인증번호를 확인할 수 없습니다. 안내 종료 후 다시 시도해 주세요." }, { status: 409, headers });
    }
    const [attemptRows] = await connection.query<RowDataPacket[]>(`SELECT attempt_id AS attemptId,table_id AS tableId,issuance_id AS issuanceId,
      state,failed_attempts AS failedAttempts,
      CAST(UNIX_TIMESTAMP(expires_at)*1000 AS UNSIGNED) AS requestExpiresAtMs,
      CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) AS serverNowMs
      FROM qr_order_auth_attempts WHERE attempt_id=? AND qr_session_id=? FOR UPDATE`, [body.attemptId, member.qrSessionId]);
    const attempt = attemptRows[0];
    if (!attempt || Number(attempt.tableId) !== member.tableId) {
      await connection.rollback();
      return Response.json({ success: false, message: "인증 요청을 찾을 수 없거나 현재 QR 세션과 일치하지 않습니다." }, { status: 404, headers });
    }
    const expiresAtMs = Number(attempt.requestExpiresAtMs);
    const nowMs = Number(attempt.serverNowMs);
    if (expiresAtMs <= nowMs) {
      await connection.query("UPDATE qr_order_auth_attempts SET state='EXPIRED' WHERE attempt_id=? AND state IN ('PENDING','VERIFIED')", [attempt.attemptId]);
      await connection.commit();
      return Response.json({ success: false, code: "ATTEMPT_EXPIRED", message: "인증 시간이 만료되었습니다. 새 인증을 요청해 주세요." }, { status: 409, headers });
    }
    if (attempt.state === "VERIFIED") {
      await connection.commit();
      return Response.json({ success: true, verified: true, duplicate: true, attemptId: attempt.attemptId,
        requestExpiresAtMs: expiresAtMs, serverNowMs: nowMs }, { headers });
    }
    if (attempt.state !== "PENDING") {
      await connection.rollback();
      return Response.json({ success: false, code: attempt.state, message: "이 인증 시도는 더 이상 사용할 수 없습니다. 다시 요청해 주세요." }, { status: 409, headers });
    }

    const [codeRows] = await connection.query<RowDataPacket[]>(`SELECT issuance_id AS issuanceId,code,
      (expires_at>CURRENT_TIMESTAMP(3)) AS isActive,
      CAST(UNIX_TIMESTAMP(expires_at)*1000 AS UNSIGNED) AS codeExpiresAtMs,
      CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) AS serverNowMs
      FROM tv_qr_auth_code_state WHERE state_id=1 FOR UPDATE`);
    const currentCode = codeRows[0];
    if (!currentCode || Number(currentCode.isActive) !== 1 || currentCode.issuanceId !== attempt.issuanceId) {
      await connection.query("UPDATE qr_order_auth_attempts SET state='EXPIRED' WHERE attempt_id=? AND state='PENDING'", [attempt.attemptId]);
      await connection.commit();
      return Response.json({ success: false, code: "CODE_EXPIRED", message: "매장 인증번호가 만료되었습니다. 새 인증번호를 요청해 주세요." }, { status: 409, headers });
    }

    if (currentCode.code !== body.code) {
      const next = nextQrOrderAuthFailure(Number(attempt.failedAttempts));
      await connection.query(`UPDATE qr_order_auth_attempts SET failed_attempts=?,state=?
        WHERE attempt_id=? AND state='PENDING'`, [next.failedAttempts, next.blocked ? "BLOCKED" : "PENDING", attempt.attemptId]);
      await connection.commit();
      return Response.json({ success: false, code: next.blocked ? "ATTEMPTS_BLOCKED" : "CODE_MISMATCH",
        attemptsRemaining: Math.max(0, 3 - next.failedAttempts), message: next.blocked
          ? "인증번호 입력 횟수를 초과했습니다. 새 인증을 요청해 주세요."
          : `인증번호가 일치하지 않습니다. 남은 횟수 ${3 - next.failedAttempts}회` }, { status: 422, headers });
    }

    const [updated] = await connection.query<ResultSetHeader>(`UPDATE qr_order_auth_attempts SET state='VERIFIED',verified_at=CURRENT_TIMESTAMP(3)
      WHERE attempt_id=? AND state='PENDING' AND failed_attempts<3`, [attempt.attemptId]);
    if (updated.affectedRows !== 1) {
      await connection.rollback();
      return Response.json({ success: false, message: "인증 상태가 변경되었습니다. 다시 확인해 주세요." }, { status: 409, headers });
    }
    await connection.commit();
    return Response.json({ success: true, verified: true, duplicate: false, attemptId: attempt.attemptId,
      requestExpiresAtMs: expiresAtMs, codeExpiresAtMs: rowTimestamp(currentCode.codeExpiresAtMs), serverNowMs: rowTimestamp(currentCode.serverNowMs) }, { headers });
  } catch (error) {
    await connection?.rollback().catch(() => undefined);
    console.error("QR order auth verification failed", error);
    return Response.json({ success: false, message: "인증을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 503, headers });
  } finally { connection?.release(); }
}
