"use client";

import { useEffect, useState } from "react";
import { parseJsonResponse } from "@/lib/api-response";
import { isStaleTvQrAuthCodeResponse } from "@/lib/tdktv-qr-auth-code-policy";

type TvQrAuthCodeResponse = {
  success: boolean;
  code: string | null;
  issuanceId: string | null;
  issuedAtMs: number | null;
  lastRequestedAtMs: number | null;
  expiresAtMs: number | null;
  stateVersion: string;
  serverNowMs: number;
};

type DisplayState = { code: string | null; expiresAtMs: number | null; serverOffsetMs: number };

export function useTvQrAuthCode(endpoint: string, enabled = true) {
  const [display, setDisplay] = useState<DisplayState>({ code: null, expiresAtMs: null, serverOffsetMs: 0 });

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let live = true;
    let requestSequence = 0;
    let acceptedSequence = 0;
    let highestVersion = "0";
    let latestServerNow = 0;
    let expiryTimer: number | undefined;

    const refresh = async () => {
      const sequence = ++requestSequence;
      const requestStartedAt = Date.now();
      try {
        const response = await fetch(endpoint, { cache: "no-store" });
        const result = await parseJsonResponse<TvQrAuthCodeResponse>(response, response.url, "TV QR auth code", "GET");
        if (!live || sequence < acceptedSequence || !result.success) return;
        if (isStaleTvQrAuthCodeResponse(result, { stateVersion: highestVersion, serverNowMs: latestServerNow })) return;
        highestVersion = result.stateVersion;
        latestServerNow = result.serverNowMs;
        acceptedSequence = sequence;
        const receivedAt = Date.now();
        const roundTripMs = receivedAt - requestStartedAt;
        const estimatedServerNowAtReceipt = result.serverNowMs + roundTripMs;
        const serverOffsetMs = estimatedServerNowAtReceipt - receivedAt;
        const remainingMs = result.expiresAtMs === null ? 0 : result.expiresAtMs - estimatedServerNowAtReceipt;
        const next = { code: remainingMs > 0 ? result.code : null, expiresAtMs: result.expiresAtMs, serverOffsetMs };
        setDisplay(current => current.code === next.code && current.expiresAtMs === next.expiresAtMs ? current : next);
        if (expiryTimer !== undefined) window.clearTimeout(expiryTimer);
        if (next.code && next.expiresAtMs !== null) {
          expiryTimer = window.setTimeout(() => {
            if (live) {
              setDisplay(current => current.expiresAtMs === next.expiresAtMs
                ? { ...current, code: null } : current);
            }
          }, remainingMs);
        }
      } catch {
        // Keep the last accepted value; its locally scheduled server-time expiry still clears it.
      }
    };

    void refresh();
    const interval = window.setInterval(() => void refresh(), 1000);
    return () => {
      live = false;
      window.clearInterval(interval);
      if (expiryTimer !== undefined) window.clearTimeout(expiryTimer);
    };
  }, [endpoint, enabled]);

  if (!enabled || !display.code || display.expiresAtMs === null) return null;
  return display.code;
}
