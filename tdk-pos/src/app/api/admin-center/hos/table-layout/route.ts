import { eq } from "drizzle-orm";
import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import { isValidHosTableLayout, type HosTableLayoutRecord } from "@/lib/hos-table-layout";
import { loadHosTables } from "@/lib/hos-table-data";
import { HOS_DIVIDER_LIMIT, HOS_DIVIDER_SETTING_KEY } from "@/lib/hos-section-layout";

export const dynamic = "force-dynamic";

const GRID_SETTING_KEY = "hos.table-layout-grid";
const GRID_SPACINGS = [5, 10, 20, 25, 50] as const;
const DEFAULT_GRID_SETTINGS = { spacing: 10, snapToGrid: true } as const;
type GridSettings = { spacing: number; snapToGrid: boolean };

function parseGridSettings(value: string | null | undefined): GridSettings {
  if (!value) return { ...DEFAULT_GRID_SETTINGS };
  try {
    const parsed = JSON.parse(value) as Partial<GridSettings>;
    return {
      spacing: GRID_SPACINGS.includes(parsed.spacing as typeof GRID_SPACINGS[number]) ? Number(parsed.spacing) : DEFAULT_GRID_SETTINGS.spacing,
      snapToGrid: typeof parsed.snapToGrid === "boolean" ? parsed.snapToGrid : DEFAULT_GRID_SETTINGS.snapToGrid,
    };
  } catch {
    return { ...DEFAULT_GRID_SETTINGS };
  }
}

async function requireLayoutOwner() {
  const member = await getCurrentAdminStaff();
  if (!member) return { response: Response.json({ success: false, message: "ADM sign-in is required." }, { status: 401 }) };
  if (member.role !== "OWNER") return { response: Response.json({ success: false, message: "Only an ADM owner can manage the HOS layout." }, { status: 403 }) };
  return { member };
}

export async function GET() {
  const access = await requireLayoutOwner();
  if ("response" in access) return access.response;
  try {
    const [tables, settingRows] = await Promise.all([
      loadHosTables(true),
      db.select({ value: systemSettings.settingValue }).from(systemSettings)
        .where(eq(systemSettings.settingKey, GRID_SETTING_KEY)).limit(1),
    ]);
    return Response.json({ success: true, ...tables, gridSettings: parseGridSettings(settingRows[0]?.value) },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("ADM HOS layout read failed", { code: (error as { code?: string }).code });
    return Response.json({ success: false, message: "HOS layout data is unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

type LayoutInput = HosTableLayoutRecord;
const validTableId = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0;

export async function PUT(request: Request) {
  const access = await requireLayoutOwner();
  if ("response" in access) return access.response;
  try {
    const body = await request.json() as { layouts?: unknown; gridSettings?: unknown; dividerPositions?: unknown };
    if (!Array.isArray(body.layouts) || body.layouts.length > 300) {
      return Response.json({ success: false, message: "Invalid HOS layout." }, { status: 400 });
    }
    const layouts = body.layouts as LayoutInput[];
    let gridSettings: GridSettings | undefined;
    if (body.gridSettings !== undefined) {
      const candidate = body.gridSettings as Partial<GridSettings> | null;
      if (!candidate || !GRID_SPACINGS.includes(candidate.spacing as typeof GRID_SPACINGS[number]) || typeof candidate.snapToGrid !== "boolean") {
        return Response.json({ success: false, message: "Invalid HOS layout grid settings." }, { status: 400 });
      }
      gridSettings = { spacing: Number(candidate.spacing), snapToGrid: candidate.snapToGrid };
    }
    let dividerPositions: number[] | undefined;
    if (body.dividerPositions !== undefined) {
      if (!Array.isArray(body.dividerPositions) || body.dividerPositions.length > HOS_DIVIDER_LIMIT ||
        body.dividerPositions.some(position => typeof position !== "number" || !Number.isFinite(position) || position <= 0 || position >= 100)) {
        return Response.json({ success: false, message: "Invalid HOS divider position." }, { status: 400 });
      }
      dividerPositions = body.dividerPositions as number[];
    }
    if (layouts.some(item => !validTableId(item.tableId) || !item.tableNo || typeof item.isVisible !== "boolean" || !isValidHosTableLayout(item))) {
      return Response.json({ success: false, message: "Invalid HOS table position or size." }, { status: 400 });
    }
    const ids = layouts.map(item => item.tableId);
    if (new Set(ids).size !== ids.length) {
      return Response.json({ success: false, message: "Duplicate HOS table layout." }, { status: 400 });
    }

    const current = await loadHosTables(true);
    const activeById = new Map(current.tables.map(table => [table.tableId, table]));
    if (activeById.size !== ids.length || ids.some(id => !activeById.has(id))) {
      return Response.json({ success: false, code: "TABLES_CHANGED", message: "The table list changed. Reload the layout and try again." }, { status: 409 });
    }
    for (const layout of layouts) {
      const table = activeById.get(layout.tableId);
      if (!table || table.tableNo !== layout.tableNo) {
        return Response.json({ success: false, code: "TABLES_CHANGED", message: "The table list changed. Reload the layout and try again." }, { status: 409 });
      }
      if (!layout.isVisible && table.sessionId !== null) {
        return Response.json({ success: false, code: "TABLE_IN_USE", message: `Table ${table.tableNo} has an open order and cannot be hidden.` }, { status: 409 });
      }
    }

    await db.transaction(async tx => {
      for (const layout of layouts) {
        const key = `hos.table-layout.${layout.tableId}`;
        const value = JSON.stringify({ positionX: layout.positionX, positionY: layout.positionY,
          layoutWidth: layout.layoutWidth, layoutHeight: layout.layoutHeight, isVisible: layout.isVisible });
        await tx.insert(systemSettings).values({ settingKey: key, settingValue: value, updatedByStaffId: access.member.staffId })
          .onDuplicateKeyUpdate({ set: { settingValue: value, updatedAt: new Date(), updatedByStaffId: access.member.staffId } });
      }
      if (gridSettings) {
        await tx.insert(systemSettings).values({ settingKey: GRID_SETTING_KEY, settingValue: JSON.stringify(gridSettings), updatedByStaffId: access.member.staffId })
          .onDuplicateKeyUpdate({ set: { settingValue: JSON.stringify(gridSettings), updatedAt: new Date(), updatedByStaffId: access.member.staffId } });
      }
      if (dividerPositions) {
        await tx.insert(systemSettings).values({ settingKey: HOS_DIVIDER_SETTING_KEY, settingValue: JSON.stringify(dividerPositions), updatedByStaffId: access.member.staffId })
          .onDuplicateKeyUpdate({ set: { settingValue: JSON.stringify(dividerPositions), updatedAt: new Date(), updatedByStaffId: access.member.staffId } });
      }
    });
    return Response.json({ success: true, savedCount: layouts.length, gridSettings, dividerPositions }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("ADM HOS layout save failed", { code: (error as { code?: string }).code });
    return Response.json({ success: false, message: "HOS layout could not be saved." },
      { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
