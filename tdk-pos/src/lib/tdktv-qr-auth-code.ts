import "server-only";

import { randomInt, randomUUID } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { pool } from "@/db";
import { formatTvQrAuthCode } from "@/lib/tdktv-qr-auth-code-policy";

export type TvQrAuthCodeStatus = {
  code: string | null;
  issuanceId: string | null;
  issuedAtMs: number | null;
  lastRequestedAtMs: number | null;
  expiresAtMs: number | null;
  stateVersion: string;
  serverNowMs: number;
};

type StatusRow = RowDataPacket & {
  code: string | null;
  issuanceId: string | null;
  issuedAtMs: number | string | null;
  lastRequestedAtMs: number | string | null;
  expiresAtMs: number | string | null;
  stateVersion: string | number;
  serverNowMs: number | string;
  isActive: number | string;
};

const statusSelect = `SELECT issuance_id AS issuanceId, code,
  CAST(UNIX_TIMESTAMP(issued_at) * 1000 AS UNSIGNED) AS issuedAtMs,
  CAST(UNIX_TIMESTAMP(last_requested_at) * 1000 AS UNSIGNED) AS lastRequestedAtMs,
  CAST(UNIX_TIMESTAMP(expires_at) * 1000 AS UNSIGNED) AS expiresAtMs,
  CAST(state_version AS CHAR) AS stateVersion,
  CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000 AS UNSIGNED) AS serverNowMs,
  (expires_at > CURRENT_TIMESTAMP(3)) AS isActive
  FROM tv_qr_auth_code_state WHERE state_id = 1`;

function statusFromRow(row: StatusRow): TvQrAuthCodeStatus {
  const active = Number(row.isActive) === 1;
  return {
    code: active ? row.code : null,
    issuanceId: active ? row.issuanceId : null,
    issuedAtMs: row.issuedAtMs == null ? null : Number(row.issuedAtMs),
    lastRequestedAtMs: row.lastRequestedAtMs == null ? null : Number(row.lastRequestedAtMs),
    expiresAtMs: row.expiresAtMs == null ? null : Number(row.expiresAtMs),
    stateVersion: String(row.stateVersion),
    serverNowMs: Number(row.serverNowMs),
  };
}

export async function readTvQrAuthCodeStatus(): Promise<TvQrAuthCodeStatus> {
  const [rows] = await pool.query<StatusRow[]>(statusSelect);
  if (!rows[0]) throw new Error("TV QR authentication code state is not initialized");
  return statusFromRow(rows[0]);
}

/** Caller owns the transaction. Locking the singleton state row serializes all issuers. */
export async function issueTvQrAuthCodeInTransaction(connection: PoolConnection): Promise<TvQrAuthCodeStatus> {
  await connection.query("INSERT INTO tv_qr_auth_code_state (state_id) VALUES (1) ON DUPLICATE KEY UPDATE state_id = VALUES(state_id)");
  const [rows] = await connection.query<StatusRow[]>(`${statusSelect} FOR UPDATE`);
  const current = rows[0];
  if (!current) throw new Error("TV QR authentication code state is not initialized");

  if (Number(current.isActive) === 1) {
    await connection.query(`UPDATE tv_qr_auth_code_state
      SET last_requested_at = CURRENT_TIMESTAMP(3),
        expires_at = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 10 SECOND),
        state_version = state_version + 1,
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE state_id = 1`);
  } else {
    const code = formatTvQrAuthCode(randomInt(0, 100));
    await connection.query(`UPDATE tv_qr_auth_code_state
      SET issuance_id = ?, code = ?, issued_at = CURRENT_TIMESTAMP(3),
        last_requested_at = CURRENT_TIMESTAMP(3),
        expires_at = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 10 SECOND),
        state_version = state_version + 1,
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE state_id = 1`, [randomUUID(), code]);
  }

  const [updatedRows] = await connection.query<StatusRow[]>(statusSelect);
  if (!updatedRows[0]) throw new Error("TV QR authentication code state update failed");
  return statusFromRow(updatedRows[0]);
}

/** Test-only public wrapper. Production issuance uses the same transactional primitive behind a stricter API gate. */
export async function issueTestTvQrAuthCode(): Promise<TvQrAuthCodeStatus> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const status = await issueTvQrAuthCodeInTransaction(connection);
    await connection.commit();
    return status;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
