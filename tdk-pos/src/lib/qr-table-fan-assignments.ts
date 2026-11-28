import "server-only";

import { eq } from "drizzle-orm";
import type { RowDataPacket } from "mysql2";
import { db, pool } from "@/db";
import { diningTables, systemSettings } from "@/db/schema";
import { loadPosFanLayouts } from "@/lib/pos-fan-server";
import { assignTableFan, parseTableFanAssignments } from "@/lib/qr-table-fan-policy";

const SETTING_KEY = "qr.table-fan-assignments";

export async function loadTableFanAssignments() {
  const [row] = await db.select({ value: systemSettings.settingValue }).from(systemSettings)
    .where(eq(systemSettings.settingKey, SETTING_KEY)).limit(1);
  return parseTableFanAssignments(row?.value);
}

export async function getAssignedTableFan(tableId: number) {
  const assignments = await loadTableFanAssignments();
  const fanId = assignments[String(tableId)];
  if (!fanId) return null;
  const layouts = await loadPosFanLayouts();
  return layouts.find(layout => layout.fanId === fanId && layout.isVisible) ?? null;
}

export async function setTableFanAssignment(tableId: number, fanId: number | null, staffId: number) {
  const [tables, layouts] = await Promise.all([
    db.select({ tableId: diningTables.tableId, isActive: diningTables.isActive }).from(diningTables),
    loadPosFanLayouts(),
  ]);
  if (!tables.some(table => Number(table.tableId) === tableId && table.isActive === 1)) return "TABLE_NOT_FOUND" as const;
  if (fanId !== null && !layouts.some(layout => layout.fanId === fanId && layout.isVisible)) return "FAN_NOT_FOUND" as const;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query("INSERT IGNORE INTO system_settings (setting_key, setting_value, updated_by_staff_id) VALUES (?, '{}', ?)", [SETTING_KEY, staffId]);
    const [rows] = await connection.query<RowDataPacket[]>("SELECT setting_value FROM system_settings WHERE setting_key = ? FOR UPDATE", [SETTING_KEY]);
    const current = parseTableFanAssignments(rows[0]?.setting_value as string | undefined);
    const next = assignTableFan(current, tableId, fanId);
    const serialized = JSON.stringify(next);
    if (serialized.length > 255) {
      await connection.rollback();
      return "ASSIGNMENT_LIMIT" as const;
    }
    await connection.query("UPDATE system_settings SET setting_value = ?, updated_at = CURRENT_TIMESTAMP, updated_by_staff_id = ? WHERE setting_key = ?",
      [serialized, staffId, SETTING_KEY]);
    await connection.commit();
    return "OK" as const;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
