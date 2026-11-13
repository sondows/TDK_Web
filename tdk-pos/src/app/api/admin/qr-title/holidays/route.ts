import { getCurrentAdminStaff, requireOwnerSecurityAccess } from "@/lib/admin-auth";
import { hasVerifiedExternalHttpsIngress, hasVerifiedLocalDevelopmentIngress } from "@/lib/host-access";
import {
  deleteKasiHolidayServiceKey, getKasiHolidayAdminState, KasiHolidayVaultError, saveKasiHolidayApiMetadata, saveKasiHolidayServiceKey,
  syncKasiHolidayCalendar, testKasiHolidayConnection,
} from "@/lib/kasi-holiday-service";

export const dynamic = "force-dynamic";

function secureCredentialTransport(request: Request) {
  return hasVerifiedLocalDevelopmentIngress(request.headers) || hasVerifiedExternalHttpsIngress(request.headers);
}

async function authorizeOwner() {
  const denied = await requireOwnerSecurityAccess();
  if (denied) return { error: denied };
  const staff = await getCurrentAdminStaff();
  return staff ? { staff } : { error: Response.json({ success: false, message: "OWNER 인증이 필요합니다." }, { status: 401 }) };
}

export async function GET() {
  const auth = await authorizeOwner();
  if (auth.error) return auth.error;
  try {
    return Response.json({ success: true, ...(await getKasiHolidayAdminState()) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ success: false, message: "공휴일 API 상태를 불러오지 못했습니다." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function PUT(request: Request) {
  const auth = await authorizeOwner();
  if (auth.error) return auth.error;
  if (!secureCredentialTransport(request)) {
    return Response.json({ success: false, message: "API 인증키는 로컬 개발 환경 또는 HTTPS 접속에서만 등록할 수 있습니다." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const body = await request.json() as {
      serviceKey?: unknown;
      api?: { name?: unknown; provider?: unknown; purpose?: unknown; active?: unknown };
    };
    const serviceKey = typeof body.serviceKey === "string" ? body.serviceKey.trim() : "";
    const apiInput = body.api;
    if (apiInput && (typeof apiInput.name !== "string" || typeof apiInput.provider !== "string" || typeof apiInput.purpose !== "string" || typeof apiInput.active !== "boolean")) {
      return Response.json({ success: false, message: "API 이름, 제공기관, 사용 목적을 확인해 주세요." }, { status: 400 });
    }
    const api = apiInput as { name: string; provider: string; purpose: string; active: boolean } | undefined;
    if (api && (!api.name.trim() || [...api.name.trim()].length > 80 || /[\u0000-\u001f\u007f]/.test(api.name)
      || !api.provider.trim() || [...api.provider.trim()].length > 60 || /[\u0000-\u001f\u007f]/.test(api.provider)
      || !api.purpose.trim() || [...api.purpose.trim()].length > 100 || /[\u0000-\u001f\u007f]/.test(api.purpose))) {
      return Response.json({ success: false, message: "API 이름, 제공기관, 사용 목적을 확인해 주세요." }, { status: 400 });
    }
    const current = await getKasiHolidayAdminState();
    if (!serviceKey && !current.configured) return Response.json({ success: false, message: "공공데이터포털 인증키를 입력해 주세요." }, { status: 400 });
    if (serviceKey) await saveKasiHolidayServiceKey(serviceKey, auth.staff.staffId);
    if (api) {
      await saveKasiHolidayApiMetadata({ name: api.name, provider: api.provider, purpose: api.purpose, active: api.active }, auth.staff.staffId);
    }
    const sync = serviceKey && api?.active !== false ? await syncKasiHolidayCalendar({ force: true }) : null;
    const state = await getKasiHolidayAdminState();
    const responseMessage = !serviceKey ? "API 정보를 저장했습니다." : api?.active === false
      ? "인증정보를 저장했습니다. API 사용이 중지되어 공휴일 동기화는 실행하지 않았습니다."
      : sync === null ? "인증정보를 저장했습니다. 다른 동기화가 끝나면 다시 시도해 주세요."
        : sync.success ? "인증정보를 저장하고 공휴일 정보를 가져왔습니다."
          : `인증정보는 저장했지만 공휴일 동기화에 실패했습니다. ${sync.message ?? "기존 공휴일 정보는 유지됩니다."}`;
    return Response.json({ success: true, message: responseMessage, syncSuccess: sync?.success ?? false, ...state }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof KasiHolidayVaultError ? error.message : "인증키를 안전하게 저장하지 못했습니다.";
    return Response.json({ success: false, message }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}

export async function DELETE(request: Request) {
  const auth = await authorizeOwner();
  if (auth.error) return auth.error;
  if (!secureCredentialTransport(request)) {
    return Response.json({ success: false, message: "API 인증키는 로컬 개발 환경 또는 HTTPS 접속에서만 삭제할 수 있습니다." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  try {
    await deleteKasiHolidayServiceKey();
    return Response.json({ success: true, message: "인증키를 삭제했습니다. 이미 가져온 공휴일과 수동 영업시간 설정은 유지됩니다.", ...(await getKasiHolidayAdminState()) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ success: false, message: "인증키를 삭제하지 못했습니다." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: Request) {
  const auth = await authorizeOwner();
  if (auth.error) return auth.error;
  try {
    const body = await request.json() as { action?: unknown };
    if (body.action === "test") {
      const result = await testKasiHolidayConnection();
      return Response.json({ success: result.success, message: result.success ? "한국천문연구원 API 연결 성공" : result.message, ...(await getKasiHolidayAdminState()) }, { status: result.success ? 200 : 502, headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "sync") {
      const result = await syncKasiHolidayCalendar({ force: true });
      if (!result) return Response.json({ success: false, message: "다른 공휴일 동기화가 진행 중입니다. 잠시 후 다시 시도해 주세요." }, { status: 409, headers: { "Cache-Control": "no-store" } });
      return Response.json({ success: result.success, message: result.success ? `공휴일 ${result.count}건을 가져왔습니다.` : result.message, ...(await getKasiHolidayAdminState()) }, { status: result.success ? 200 : 502, headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ success: false, message: "요청 작업을 확인해 주세요." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ success: false, message: "공휴일 API 요청을 처리하지 못했습니다." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
