import { requireAdminAccess } from "@/lib/admin-auth";
import { getKasiHolidayAdminState } from "@/lib/kasi-holiday-service";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdminAccess();
  if (denied) return denied;
  try {
    const state = await getKasiHolidayAdminState();
    return Response.json({
      success: true, configured: state.configured,
      api: { name: state.api.name, provider: state.api.provider, purpose: state.api.purpose, active: state.api.active },
      connectionStatus: state.connectionStatus, lastCheckedAt: state.lastCheckedAt,
      lastSyncAt: state.lastSyncAt, lastSyncStatus: state.lastSyncStatus,
      lastSyncCount: state.lastSyncCount, lastSyncYears: state.lastSyncYears,
      lastError: state.lastError,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ success: false, message: "공휴일 연동 상태를 불러오지 못했습니다." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
