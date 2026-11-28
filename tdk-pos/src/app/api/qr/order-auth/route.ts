import { randomUUID } from "node:crypto";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool } from "@/db";
import { enrichQrCatalog, qrWaitCartTotal, validateQrWaitCart } from "@/lib/qr-wait-order-data";
import { loadQrMenuCatalog } from "@/lib/qr-menu-catalog";
import { isSameOriginQrRequest } from "@/lib/qr-visit-session";
import { getQrOrderAuthApiError, resolveQrOrderRequest } from "@/lib/qr-order-auth";
import { QR_ORDER_AUTH_ATTEMPT_TTL_MS, QR_ORDER_AUTH_MAX_FAILURES, QR_ORDER_AUTH_MAX_NEW_ATTEMPTS_PER_SESSION,
  QR_ORDER_AUTH_MAX_NEW_ATTEMPTS_PER_TABLE, QR_ORDER_AUTH_RATE_WINDOW_MS,
  qrOrderAuthCartFingerprint } from "@/lib/qr-order-auth-attempt-policy";
import { issueTvQrAuthCodeInTransaction } from "@/lib/tdktv-qr-auth-code";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const uuidPattern = /^[0-9a-f-]{36}$/i;

function attemptResponse(row: RowDataPacket, duplicate: boolean) {
  return { success: true, attemptId: row.attemptId, state: row.state,
    requestExpiresAtMs: Number(row.requestExpiresAtMs), codeExpiresAtMs: row.codeExpiresAtMs === null ? null : Number(row.codeExpiresAtMs),
    serverNowMs: Number(row.serverNowMs), duplicate,
    attemptsRemaining: Math.max(0, QR_ORDER_AUTH_MAX_FAILURES - Number(row.failedAttempts ?? 0)) };
}

export async function GET(request: Request) {
  const unavailable = await getQrOrderAuthApiError();
  if (unavailable) return unavailable;
  const member = await resolveQrOrderRequest(request);
  if (!member) return Response.json({ success: false }, { status: 401, headers });
  try {
    const [claims] = await pool.query<RowDataPacket[]>(`SELECT state,representative_qr_session_id AS representativeQrSessionId,
      table_session_id AS tableSessionId FROM qr_table_order_claims WHERE table_id=?`, [member.tableId]);
    const claim = claims[0];
    if (!claim) return Response.json({ success: true, representativeState: "NO_REPRESENTATIVE" }, { headers });
    const own = Number(claim.representativeQrSessionId) === member.qrSessionId;
    if (claim.state === "PENDING") return Response.json({ success: true,
      representativeState: own ? "OWN_PENDING" : "OTHER_PENDING" }, { headers });
    const [sessions] = await pool.query<RowDataPacket[]>(`SELECT session_id AS sessionId FROM table_sessions
      WHERE session_id=? AND table_id=? AND status='OPEN' AND session_kind='DINE_IN'`, [claim.tableSessionId, member.tableId]);
    if (!sessions.length) return Response.json({ success: true, representativeState: "STALE" }, { headers });
    return Response.json({ success: true, representativeState: own && Number(member.sessionId) === Number(claim.tableSessionId)
      ? "OWN_CONFIRMED" : "OTHER_CONFIRMED" }, { headers });
  } catch (error) {
    console.error("QR representative status failed", error);
    return Response.json({ success: false }, { status: 503, headers });
  }
}

export async function POST(request: Request) {
  if (!isSameOriginQrRequest(request)) return Response.json({ success: false }, { status: 403, headers });
  const unavailable = await getQrOrderAuthApiError();
  if (unavailable) return unavailable;
  const member = await resolveQrOrderRequest(request);
  if (!member) return Response.json({ success: false, message: "테이블 QR 인증이 만료되었습니다. QR을 다시 스캔해 주세요." }, { status: 401, headers });
  const body = await request.json().catch(() => null) as { requestId?: unknown; cart?: unknown } | null;
  if (!body || typeof body.requestId !== "string" || !uuidPattern.test(body.requestId) || !Array.isArray(body.cart)) {
    return Response.json({ success: false, message: "인증 요청 정보가 올바르지 않습니다." }, { status: 400, headers });
  }

  let connection: PoolConnection | null = null;
  try {
    const catalog = enrichQrCatalog(await loadQrMenuCatalog());
    const lines = validateQrWaitCart(body.cart, catalog);
    if (!lines?.length || qrWaitCartTotal(lines) < 0) return Response.json({ success: false, message: "장바구니 메뉴를 확인해 주세요." }, { status: 400, headers });
    const cartFingerprint = qrOrderAuthCartFingerprint(lines.map(({ line }) => ({ menuId: line.menuId, qty: line.qty,
      options: line.options.map(option => ({ modifierOptionId: option.modifierOptionId, qty: option.qty })) })));
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [tableRows] = await connection.query<RowDataPacket[]>("SELECT table_id AS tableId FROM dining_tables WHERE table_id=? AND is_active=1 FOR UPDATE", [member.tableId]);
    const table = tableRows[0];
    if (!table) { await connection.rollback(); return Response.json({ success: false, message: "테이블 QR 세션을 확인할 수 없습니다." }, { status: 409, headers }); }
    const [sessionRows] = await connection.query<RowDataPacket[]>(`SELECT qr_session_id AS qrSessionId,table_id AS tableId,
      session_id AS sessionId,status FROM qr_sessions WHERE qr_session_id=? FOR UPDATE`, [member.qrSessionId]);
    const session = sessionRows[0];
    if (!session || session.status !== "ACTIVE" || Number(session.tableId) !== member.tableId ||
      (session.sessionId !== null && Number(session.sessionId) !== member.sessionId)) {
      await connection.rollback();
      return Response.json({ success: false, message: "고객 세션이 만료되었거나 테이블 연결이 변경되었습니다." }, { status: 409, headers });
    }
    if (session.sessionId !== null) {
      const [visits] = await connection.query<RowDataPacket[]>(`SELECT session_id FROM table_sessions
        WHERE session_id=? AND table_id=? AND status='OPEN' AND session_kind='DINE_IN' FOR UPDATE`, [session.sessionId, member.tableId]);
      if (!visits.length) { await connection.rollback(); return Response.json({ success: false, message: "테이블 이용이 종료되었습니다." }, { status: 409, headers }); }
    }
    const [openSessions] = await connection.query<RowDataPacket[]>(`SELECT session_id AS sessionId FROM table_sessions
      WHERE table_id=? AND status='OPEN' AND session_kind='DINE_IN' FOR UPDATE`, [member.tableId]);
    if (openSessions.length > 1) {
      await connection.rollback();
      return Response.json({ success: false, message: "테이블 이용 세션이 중복되어 인증할 수 없습니다." }, { status: 409, headers });
    }
    const authTableSessionId = openSessions[0] ? Number(openSessions[0].sessionId) : null;
    const [qrRows] = await connection.query<RowDataPacket[]>(`SELECT code.qr_code_id FROM qr_table_links link
      INNER JOIN qr_codes code ON code.qr_code_id=link.qr_code_id
      WHERE link.table_id=? AND code.status='IN_USE' AND code.target_type='TABLE_ORDER' LIMIT 1`, [member.tableId]);
    if (!qrRows.length) { await connection.rollback(); return Response.json({ success: false, message: "현재 사용할 수 있는 테이블 QR이 없습니다." }, { status: 409, headers }); }
    const [claims] = await connection.query<RowDataPacket[]>(`SELECT state,representative_qr_session_id AS representativeQrSessionId
      FROM qr_table_order_claims WHERE table_id=?`, [member.tableId]);
    if (claims.length) {
      await connection.rollback();
      return Response.json({ success: false, code: "REPRESENTATIVE_EXISTS", message:
        Number(claims[0].representativeQrSessionId) === member.qrSessionId && claims[0].state === "PENDING"
          ? "주문 승인 대기 중입니다." : "현재 이 테이블의 주문은 대표 고객이 진행하고 있습니다." }, { status: 409, headers });
    }
    const [noticeRows] = await connection.query<RowDataPacket[]>("SELECT is_active AS isActive FROM tv_business_notice WHERE notice_id=1 FOR UPDATE");
    if (Number(noticeRows[0]?.isActive ?? 0) === 1) {
      await connection.rollback();
      return Response.json({ success: false, code: "TV_NOTICE_ACTIVE", message: "매장 안내가 표시 중이라 인증번호를 사용할 수 없습니다. 안내 종료 후 다시 시도해 주세요." }, { status: 409, headers });
    }

    const [existingRows] = await connection.query<RowDataPacket[]>(`SELECT attempt_id AS attemptId,qr_session_id AS qrSessionId,table_id AS tableId,
      cart_fingerprint AS cartFingerprint,issuance_id AS issuanceId,state,failed_attempts AS failedAttempts,
      CAST(UNIX_TIMESTAMP(expires_at)*1000 AS UNSIGNED) AS requestExpiresAtMs,
      CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) AS serverNowMs
      FROM qr_order_auth_attempts WHERE qr_session_id=? AND client_request_id=? FOR UPDATE`, [member.qrSessionId, body.requestId]);
    const existing = existingRows[0];
    if (existing) {
      if (Number(existing.tableId) !== member.tableId || existing.cartFingerprint !== cartFingerprint) {
        await connection.rollback();
        return Response.json({ success: false, message: "같은 주문 시도 ID에 다른 장바구니가 연결되었습니다. 새로 다시 시도해 주세요." }, { status: 409, headers });
      }
      if (!["PENDING", "VERIFIED"].includes(existing.state) || Number(existing.requestExpiresAtMs) <= Number(existing.serverNowMs)) {
        await connection.rollback();
        return Response.json({ success: false, code: "ATTEMPT_NOT_REUSABLE", message: "이 인증 시도는 만료되었거나 이미 종료되었습니다. 새 인증을 요청해 주세요." }, { status: 409, headers });
      }
      const [codeRows] = await connection.query<RowDataPacket[]>(`SELECT issuance_id AS issuanceId,
        CAST(UNIX_TIMESTAMP(expires_at)*1000 AS UNSIGNED) AS codeExpiresAtMs,
        CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) AS serverNowMs
        FROM tv_qr_auth_code_state WHERE state_id=1`);
      const status = codeRows[0];
      if (existing.state === "PENDING" && (!status || status.issuanceId !== existing.issuanceId || Number(status.codeExpiresAtMs) <= Number(status.serverNowMs))) {
        await connection.query("UPDATE qr_order_auth_attempts SET state='EXPIRED' WHERE attempt_id=? AND state='PENDING'", [existing.attemptId]);
        await connection.commit();
        return Response.json({ success: false, code: "CODE_EXPIRED", message: "인증번호가 만료되었습니다. 새 인증번호를 요청해 주세요." }, { status: 409, headers });
      }
      const payload = attemptResponse({ ...existing, codeExpiresAtMs: status?.codeExpiresAtMs ?? null,
        serverNowMs: status?.serverNowMs ?? existing.serverNowMs }, true);
      await connection.commit();
      return Response.json(payload, { headers });
    }

    const [counts] = await connection.query<RowDataPacket[]>(`SELECT
      (SELECT COUNT(*) FROM qr_order_auth_attempts WHERE qr_session_id=? AND created_at>=DATE_SUB(CURRENT_TIMESTAMP(3),INTERVAL ? SECOND)) AS sessionCount,
      (SELECT COUNT(*) FROM qr_order_auth_attempts WHERE table_id=? AND created_at>=DATE_SUB(CURRENT_TIMESTAMP(3),INTERVAL ? SECOND)) AS tableCount`,
    [member.qrSessionId, QR_ORDER_AUTH_RATE_WINDOW_MS / 1000, member.tableId, QR_ORDER_AUTH_RATE_WINDOW_MS / 1000]);
    if (Number(counts[0]?.sessionCount) >= QR_ORDER_AUTH_MAX_NEW_ATTEMPTS_PER_SESSION ||
      Number(counts[0]?.tableCount) >= QR_ORDER_AUTH_MAX_NEW_ATTEMPTS_PER_TABLE) {
      await connection.rollback();
      return Response.json({ success: false, code: "RATE_LIMITED", message: "인증 요청이 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429, headers });
    }

    const issued = await issueTvQrAuthCodeInTransaction(connection);
    if (!issued.code || !issued.issuanceId || !issued.expiresAtMs) throw new Error("TV_AUTH_CODE_NOT_ACTIVE");
    const attemptId = randomUUID();
    await connection.query(`INSERT INTO qr_order_auth_attempts
      (attempt_id,qr_session_id,table_id,table_session_id_at_auth,session_snapshot_recorded,client_request_id,issuance_id,code,cart_fingerprint,state,failed_attempts,expires_at)
      VALUES (?,?,?,?,1,?,?,?,?,'PENDING',0,DATE_ADD(CURRENT_TIMESTAMP(3),INTERVAL ? SECOND))`,
    [attemptId, member.qrSessionId, member.tableId, authTableSessionId, body.requestId, issued.issuanceId, issued.code, cartFingerprint,
      QR_ORDER_AUTH_ATTEMPT_TTL_MS / 1000]);
    const [createdRows] = await connection.query<RowDataPacket[]>(`SELECT attempt_id AS attemptId,state,
      CAST(UNIX_TIMESTAMP(expires_at)*1000 AS UNSIGNED) AS requestExpiresAtMs,
      CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) AS serverNowMs
      FROM qr_order_auth_attempts WHERE attempt_id=?`, [attemptId]);
    await connection.commit();
    return Response.json(attemptResponse({ ...createdRows[0], codeExpiresAtMs: issued.expiresAtMs }, false), { status: 201, headers });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => undefined);
    console.error("QR order auth request failed", error);
    return Response.json({ success: false, message: "인증 요청을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 503, headers });
  } finally { connection?.release(); }
}

export async function DELETE(request: Request) {
  if (!isSameOriginQrRequest(request)) return Response.json({ success: false }, { status: 403, headers });
  const unavailable = await getQrOrderAuthApiError();
  if (unavailable) return unavailable;
  const member = await resolveQrOrderRequest(request);
  if (!member) return Response.json({ success: false }, { status: 401, headers });
  const body = await request.json().catch(() => null) as { attemptId?: unknown } | null;
  if (!body || typeof body.attemptId !== "string" || !uuidPattern.test(body.attemptId)) return Response.json({ success: false }, { status: 400, headers });
  try {
    const [result] = await pool.query<ResultSetHeader>(`UPDATE qr_order_auth_attempts SET state='BLOCKED'
      WHERE attempt_id=? AND qr_session_id=? AND table_id=? AND state IN ('PENDING','VERIFIED')`,
    [body.attemptId, member.qrSessionId, member.tableId]);
    return Response.json({ success: true, invalidated: result.affectedRows === 1 }, { headers });
  } catch (error) {
    console.error("QR order auth cancellation failed", error);
    return Response.json({ success: false }, { status: 503, headers });
  }
}
