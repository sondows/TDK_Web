const KASI_HOLIDAY_API_URL = "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo";
type KasiHolidayApiItem = { locdate: string | number; dateName: string; isHoliday: string };
type KasiHolidayApiResult = { resultCode: string; resultMsg: string; totalCount: number; items: KasiHolidayApiItem[] };

export class KasiHolidayApiError extends Error {
  readonly kind: "KEY" | "APPROVAL" | "LIMIT" | "UNAVAILABLE" | "FORMAT" | "UNKNOWN";
  constructor(message: string, kind: "KEY" | "APPROVAL" | "LIMIT" | "UNAVAILABLE" | "FORMAT" | "UNKNOWN" = "UNKNOWN") {
    super(message);
    this.name = "KasiHolidayApiError";
    this.kind = kind;
  }
}

function decodeXml(value: string) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
    if (entity === "amp") return "&";
    if (entity === "lt") return "<";
    if (entity === "gt") return ">";
    if (entity === "quot") return '"';
    if (entity === "apos") return "'";
    const code = entity[1]?.toLowerCase() === "x" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
    return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
}

function xmlTag(value: string, tag: string) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = value.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return match ? decodeXml(match[1].trim()) : "";
}

function responseError(code: string) {
  if (code === "03") return null;
  if (code === "20" || code === "30" || code === "31" || code === "21") return new KasiHolidayApiError("인증키 또는 API 이용 승인을 확인해 주세요.", code === "20" || code === "30" || code === "31" ? "KEY" : "APPROVAL");
  if (code === "22" || code === "23") return new KasiHolidayApiError("공휴일 API 호출 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.", "LIMIT");
  if (code === "04" || code === "05") return new KasiHolidayApiError("한국천문연구원 API에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.", "UNAVAILABLE");
  if (code === "00") return null;
  return new KasiHolidayApiError("공휴일 API 요청을 처리하지 못했습니다. 이용 승인과 API 상태를 확인해 주세요.", "UNKNOWN");
}

function normalizeItems(value: unknown): KasiHolidayApiItem[] {
  if (value === undefined || value === null || value === "") return [];
  const items = Array.isArray(value) ? value : [value];
  return items.map(item => {
    if (!item || typeof item !== "object") throw new KasiHolidayApiError("공휴일 API 응답 형식이 올바르지 않습니다.", "FORMAT");
    const row = item as Record<string, unknown>;
    if ((typeof row.locdate !== "string" && typeof row.locdate !== "number") || typeof row.isHoliday !== "string" || typeof row.dateName !== "string") {
      throw new KasiHolidayApiError("공휴일 API 응답 형식이 올바르지 않습니다.", "FORMAT");
    }
    return { locdate: row.locdate, dateName: row.dateName, isHoliday: row.isHoliday };
  });
}

export function parseKasiHolidayApiResponse(payload: string): KasiHolidayApiResult {
  try {
    const json = JSON.parse(payload) as { response?: { header?: Record<string, unknown>; body?: Record<string, unknown> } };
    const response = json.response;
    const header = response?.header;
    const body = response?.body;
    if (!header || !body) throw new KasiHolidayApiError("공휴일 API 응답 형식이 올바르지 않습니다.", "FORMAT");
    const resultCode = String(header.resultCode ?? "");
    const resultMsg = typeof header.resultMsg === "string" ? header.resultMsg : "";
    const apiError = responseError(resultCode);
    if (apiError) throw apiError;
    const totalCount = Number(body.totalCount);
    if (!Number.isInteger(totalCount) || totalCount < 0) throw new KasiHolidayApiError("공휴일 API 응답 형식이 올바르지 않습니다.", "FORMAT");
    const itemContainer = body.items && typeof body.items === "object" ? (body.items as Record<string, unknown>).item : undefined;
    return { resultCode, resultMsg, totalCount, items: normalizeItems(itemContainer) };
  } catch (error) {
    if (error instanceof KasiHolidayApiError) throw error;
    return parseKasiHolidayXmlResponse(payload);
  }
}

function parseKasiHolidayXmlResponse(payload: string): KasiHolidayApiResult {
  const header = payload.match(/<header(?:\s[^>]*)?>([\s\S]*?)<\/header>/i)?.[1];
  const body = payload.match(/<body(?:\s[^>]*)?>([\s\S]*?)<\/body>/i)?.[1];
  if (!header || !body) throw new KasiHolidayApiError("공휴일 API 응답 형식이 올바르지 않습니다.", "FORMAT");
  const resultCode = xmlTag(header, "resultCode");
  const apiError = responseError(resultCode);
  if (apiError) throw apiError;
  const totalCount = Number(xmlTag(body, "totalCount"));
  if (!Number.isInteger(totalCount) || totalCount < 0) throw new KasiHolidayApiError("공휴일 API 응답 형식이 올바르지 않습니다.", "FORMAT");
  const itemContainer = body.match(/<items(?:\s[^>]*)?>([\s\S]*?)<\/items>/i)?.[1] ?? "";
  const items = [...itemContainer.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map(([, item]) => ({
    locdate: xmlTag(item, "locdate"), dateName: xmlTag(item, "dateName"), isHoliday: xmlTag(item, "isHoliday"),
  }));
  return { resultCode, resultMsg: xmlTag(header, "resultMsg"), totalCount, items: normalizeItems(items) };
}

export function parseKasiHolidayItems(result: KasiHolidayApiResult, year: number) {
  const byDate = new Map<string, Set<string>>();
  for (const item of result.items) {
    if (item.isHoliday !== "Y") continue;
    const compactDate = String(item.locdate);
    if (!/^\d{8}$/.test(compactDate) || Number(compactDate.slice(0, 4)) !== year || !item.dateName.trim()) {
      throw new KasiHolidayApiError("공휴일 API에 올바르지 않은 날짜 정보가 포함되어 있습니다.", "FORMAT");
    }
    const date = `${compactDate.slice(0, 4)}-${compactDate.slice(4, 6)}-${compactDate.slice(6, 8)}`;
    const parsed = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new KasiHolidayApiError("공휴일 API에 올바르지 않은 날짜 정보가 포함되어 있습니다.", "FORMAT");
    const names = byDate.get(date) ?? new Set<string>();
    names.add(item.dateName.trim().slice(0, 60));
    byDate.set(date, names);
  }
  return [...byDate].map(([date, names]) => ({ date, name: [...names].join(" · ").slice(0, 120) })).sort((a, b) => a.date.localeCompare(b.date));
}

export function buildKasiHolidayRequestUrl(serviceKey: string, year: number, month?: number, pageNo = 1) {
  if (!Number.isInteger(year) || year < 2000 || year > 2200 || (month !== undefined && (!Number.isInteger(month) || month < 1 || month > 12))) {
    throw new Error("Invalid KASI API date.");
  }
  let key = serviceKey.trim();
  if (/%[\da-f]{2}/i.test(key)) {
    try { key = decodeURIComponent(key); } catch { throw new KasiHolidayApiError("인증키 인코딩을 확인해 주세요.", "KEY"); }
  }
  const url = new URL(KASI_HOLIDAY_API_URL);
  url.searchParams.set("ServiceKey", key);
  url.searchParams.set("solYear", String(year));
  if (month !== undefined) url.searchParams.set("solMonth", String(month).padStart(2, "0"));
  url.searchParams.set("pageNo", String(pageNo));
  url.searchParams.set("numOfRows", "1000");
  return url;
}

export async function fetchKasiHolidayPage(serviceKey: string, year: number, month?: number, pageNo = 1, fetcher: typeof fetch = fetch) {
  const response = await fetcher(buildKasiHolidayRequestUrl(serviceKey, year, month, pageNo), {
    method: "GET", cache: "no-store", redirect: "error",
    headers: { Accept: "application/xml, application/json;q=0.9" }, signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new KasiHolidayApiError("한국천문연구원 API에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.", "UNAVAILABLE");
  return parseKasiHolidayApiResponse(await response.text());
}
