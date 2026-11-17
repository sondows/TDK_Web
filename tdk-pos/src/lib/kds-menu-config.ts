import type { KdsMenuKind } from "./kds-model";

export type KdsMenuConfig = { kdsKind: KdsMenuKind; kdsGroupKey: string | null; kdsCompletionTimer: boolean; kdsPostCookTimer: boolean; kdsSimpleCook: boolean; kdsVisible: boolean };

export function parseKdsMenuConfig(kind: unknown, groupKey: unknown, completionTimer: unknown, visible: unknown = true, postCookTimer: unknown = false, simpleCook: unknown = false): KdsMenuConfig | null {
  if (kind !== "NONE" && kind !== "POT" && kind !== "ADDON" && kind !== "SOLO") return null;
  if (groupKey !== null && groupKey !== undefined && typeof groupKey !== "string") return null;
  const key = typeof groupKey === "string" ? groupKey.trim() : "";
  if (key.length > 60 || /[\x00-\x1f]/.test(key)) return null;
  const timer = completionTimer === true || completionTimer === "true" || completionTimer === 1;
  if (![true, false, "true", "false", 1, 0].includes(completionTimer as never)) return null;
  if (![true, false, "true", "false", 1, 0].includes(visible as never)) return null;
  if (![true, false, "true", "false", 1, 0].includes(postCookTimer as never)) return null;
  if (![true, false, "true", "false", 1, 0].includes(simpleCook as never)) return null;
  const simple = simpleCook === true || simpleCook === "true" || simpleCook === 1;
  const postCook = postCookTimer === true || postCookTimer === "true" || postCookTimer === 1;
  if (simple && postCook) return null;
  return { kdsKind: kind, kdsGroupKey: kind === "NONE" ? null : key || null, kdsCompletionTimer: kind === "NONE" ? false : timer, kdsPostCookTimer: kind === "NONE" ? false : postCook, kdsSimpleCook: kind === "NONE" ? false : simple, kdsVisible: visible === true || visible === "true" || visible === 1 };
}
