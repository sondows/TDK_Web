import "server-only";

import { eq, like } from "drizzle-orm";
import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import { DEFAULT_POS_FAN_LAYOUTS, getPosFanSettingKey, parsePosFanLayout, type PosFanLayout } from "@/lib/pos-fan-layout";
import { commandHomeAssistantSwitch, HomeAssistantApiError, readHomeAssistantState } from "@/lib/pos-fan-ha-client";

function homeAssistantConfig() {
  const baseUrl = (process.env.HOME_ASSISTANT_BASE_URL ?? "http://127.0.0.1:8123").trim().replace(/\/+$/, "");
  const token = process.env.HOME_ASSISTANT_TOKEN?.trim();
  try {
    const parsed = new URL(baseUrl);
    if (!token || !["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    return { baseUrl, token };
  } catch {
    return null;
  }
}

export async function loadPosFanLayouts(): Promise<PosFanLayout[]> {
  const rows = await db.select({ settingKey: systemSettings.settingKey, settingValue: systemSettings.settingValue })
    .from(systemSettings).where(like(systemSettings.settingKey, `${"pos.fan-layout."}%`));
  const stored = new Map<number, PosFanLayout>();
  for (const row of rows) {
    const fanId = Number(row.settingKey.slice("pos.fan-layout.".length));
    if (!Number.isInteger(fanId) || fanId < 1 || fanId > DEFAULT_POS_FAN_LAYOUTS.length) continue;
    const layout = parsePosFanLayout(row.settingValue);
    if (layout?.fanId === fanId) stored.set(fanId, layout);
  }
  return DEFAULT_POS_FAN_LAYOUTS.map(layout => stored.get(layout.fanId) ?? layout);
}

export async function getPosFanStates(layouts: PosFanLayout[]) {
  const config = homeAssistantConfig();
  if (!config) return { configured: false, fans: layouts.filter(layout => layout.isVisible).map(layout => ({
    fanId: layout.fanId, name: layout.name, positionX: layout.positionX, positionY: layout.positionY,
    isVisible: layout.isVisible, sortOrder: layout.sortOrder, state: "unknown" as const, error: "HA_NOT_CONFIGURED",
  })) };
  const fans = await Promise.all(layouts.filter(layout => layout.isVisible).map(async layout => {
    try {
      const state = await readHomeAssistantState(config, layout.entityId);
      return { fanId: layout.fanId, name: layout.name, positionX: layout.positionX, positionY: layout.positionY,
        isVisible: layout.isVisible, sortOrder: layout.sortOrder, state, error: state === "unknown" ? "HA_STATE_UNKNOWN" : null };
    } catch (error) {
      return { fanId: layout.fanId, name: layout.name, positionX: layout.positionX, positionY: layout.positionY,
        isVisible: layout.isVisible, sortOrder: layout.sortOrder, state: "unknown" as const,
        error: error instanceof HomeAssistantApiError ? error.code : "HA_STATE_UNAVAILABLE" };
    }
  }));
  return { configured: true, fans };
}

export async function commandPosFan(layout: PosFanLayout, desiredState: "on" | "off") {
  const config = homeAssistantConfig();
  if (!config) return { success: false as const, code: "HA_NOT_CONFIGURED", state: "unknown" as const };
  try {
    return await commandHomeAssistantSwitch(config, layout.entityId, desiredState);
  } catch (error) {
    return {
      success: false as const,
      code: error instanceof HomeAssistantApiError ? error.code : "HA_CONNECTION_FAILED",
      httpStatus: error instanceof HomeAssistantApiError ? error.httpStatus : undefined,
      state: "unknown" as const,
    };
  }
}

export async function findPosFanLayout(fanId: number) {
  const [row] = await db.select({ settingValue: systemSettings.settingValue }).from(systemSettings)
    .where(eq(systemSettings.settingKey, getPosFanSettingKey(fanId))).limit(1);
  const layout = parsePosFanLayout(row?.settingValue);
  return layout?.fanId === fanId ? layout : DEFAULT_POS_FAN_LAYOUTS.find(item => item.fanId === fanId) ?? null;
}
