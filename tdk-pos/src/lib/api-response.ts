function preview(body: string): string {
  const normalized = body.replace(/[\r\n\t]+/g, " ").trim();
  if (!normalized) return "(empty body)";
  return normalized.length > 240 ? `${normalized.slice(0, 240)}...` : normalized;
}

export async function readJsonResponse<T>(response: Response, requestUrl: string, stage: string): Promise<T> {
  const body = await response.text();
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(`${stage}: ${requestUrl} returned HTTP ${response.status} ${response.statusText}; expected JSON; body: ${preview(body)}`);
  }
}

export async function parseJsonResponse<T>(response: Response, requestUrl: string, stage: string): Promise<T> {
  const result = await readJsonResponse<T>(response, requestUrl, stage);

  if (!response.ok) {
    const value = result && typeof result === "object" ? result as Record<string, unknown> : null;
    const detail = typeof value?.message === "string" ? value.message : typeof value?.error === "string" ? value.error : JSON.stringify(result);
    throw new Error(`${stage}: ${requestUrl} returned HTTP ${response.status} ${response.statusText}; ${detail}`);
  }

  return result;
}
