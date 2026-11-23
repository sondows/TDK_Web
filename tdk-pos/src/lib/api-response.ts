type ApiResponseFailureKind = "NON_JSON" | "HTTP_ERROR";
type JsonPayload = Awaited<ReturnType<Response["json"]>>;

function endpointPath(requestUrl: string): string {
  try { return new URL(requestUrl, "http://localhost").pathname; }
  catch { return "[invalid-url]"; }
}

function fallbackMessage(status: number, failureKind: ApiResponseFailureKind): string {
  if (status === 401) return "로그인 상태를 확인해주세요.";
  if (status === 403) return "해당 기능에 접근할 권한이 없습니다.";
  if (status === 404) return "요청한 정보를 찾을 수 없습니다.";
  if (status === 409) return "현재 상태에서는 요청을 처리할 수 없습니다.";
  if (status >= 500) return "서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
  if (failureKind === "NON_JSON") return "서버 응답을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.";
  return "요청을 처리하지 못했습니다.";
}

export class ApiResponseError extends Error {
  readonly status: number;
  readonly requestPath: string;
  readonly stage: string;
  readonly failureKind: ApiResponseFailureKind;
  readonly method: string;

  constructor(response: Response, requestUrl: string, stage: string, failureKind: ApiResponseFailureKind, message?: string, method = "UNKNOWN") {
    super(message || fallbackMessage(response.status, failureKind));
    this.name = "ApiResponseError";
    this.status = response.status;
    this.requestPath = endpointPath(requestUrl);
    this.stage = stage;
    this.failureKind = failureKind;
    this.method = method.toUpperCase();
  }
}

function isJsonContentType(contentType: string | null): boolean {
  return Boolean(contentType && /^application\/(?:[\w.-]+\+)?json(?:\s*;|\s*$)/i.test(contentType));
}

export async function readJsonResponse<T = JsonPayload>(response: Response, requestUrl: string, stage: string, method = "UNKNOWN"): Promise<T> {
  const body = await response.text();
  if (!isJsonContentType(response.headers.get("content-type"))) {
    const error = new ApiResponseError(response, requestUrl, stage, "NON_JSON", undefined, method);
    if (process.env.NODE_ENV === "development") console.warn("API response was not JSON", {
      stage: error.stage, path: error.requestPath, method: error.method, status: error.status, failureKind: error.failureKind,
    });
    throw error;
  }
  try {
    return JSON.parse(body) as T;
  } catch {
    const error = new ApiResponseError(response, requestUrl, stage, "NON_JSON", undefined, method);
    if (process.env.NODE_ENV === "development") console.warn("API response contained invalid JSON", {
      stage: error.stage, path: error.requestPath, method: error.method, status: error.status, failureKind: error.failureKind,
    });
    throw error;
  }
}

export async function parseJsonResponse<T>(response: Response, requestUrl: string, stage: string, method = "UNKNOWN"): Promise<T> {
  const result = await readJsonResponse<T>(response, requestUrl, stage, method);

  if (!response.ok) {
    const value = result && typeof result === "object" ? result as Record<string, unknown> : null;
    const detail = typeof value?.message === "string" ? value.message : undefined;
    throw new ApiResponseError(response, requestUrl, stage, "HTTP_ERROR", detail, method);
  }

  return result;
}
