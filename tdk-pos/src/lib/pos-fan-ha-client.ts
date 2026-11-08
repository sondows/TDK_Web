export type HomeAssistantFanState = "on" | "off" | "unknown";
export type HomeAssistantConfig = { baseUrl: string; token: string };

export class HomeAssistantApiError extends Error {
  readonly code: string;
  readonly httpStatus?: number;

  constructor(code: string, httpStatus?: number) {
    super(code);
    this.name = "HomeAssistantApiError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function apiUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, "")}/api/${path.replace(/^\/+/, "")}`;
}

async function request(fetcher: typeof fetch, url: string, init: RequestInit, timeoutMs: number) {
  try {
    return await fetcher(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new HomeAssistantApiError("HA_CONNECTION_FAILED");
  }
}

export async function readHomeAssistantState(config: HomeAssistantConfig, entityId: string, fetcher: typeof fetch = fetch): Promise<HomeAssistantFanState> {
  const response = await request(fetcher, apiUrl(config.baseUrl, `states/${encodeURIComponent(entityId)}`), {
    headers: { Authorization: `Bearer ${config.token}` },
  }, 4000);
  if (!response.ok) {
    const code = response.status === 401 ? "HA_AUTH_FAILED" : response.status === 403 ? "HA_PERMISSION_DENIED" : response.status === 404 ? "HA_ENTITY_NOT_FOUND" : "HA_STATE_UNAVAILABLE";
    throw new HomeAssistantApiError(code, response.status);
  }
  try {
    const result = await response.json() as { state?: unknown };
    return result.state === "on" ? "on" : result.state === "off" ? "off" : "unknown";
  } catch {
    throw new HomeAssistantApiError("HA_INVALID_RESPONSE", response.status);
  }
}

export async function commandHomeAssistantSwitch(
  config: HomeAssistantConfig,
  entityId: string,
  desiredState: "on" | "off",
  fetcher: typeof fetch = fetch,
) {
  const response = await request(fetcher, apiUrl(config.baseUrl, `services/switch/turn_${desiredState}`), {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ entity_id: entityId }),
  }, 6000);

  if (!response.ok) {
    const code = response.status === 401 ? "HA_AUTH_FAILED" : response.status === 403 ? "HA_PERMISSION_DENIED" : response.status === 404 ? "HA_ENTITY_NOT_FOUND" : "HA_COMMAND_FAILED";
    throw new HomeAssistantApiError(code, response.status);
  }

  let state: HomeAssistantFanState = "unknown";
  for (let attempt = 0; attempt < 6; attempt += 1) {
    state = await readHomeAssistantState(config, entityId, fetcher);
    if (state === desiredState) return { success: true as const, state };
    if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 400));
  }
  throw new HomeAssistantApiError("HA_STATE_NOT_CONFIRMED");
}
