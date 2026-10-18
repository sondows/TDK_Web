"use client";

import { useEffect, useState } from "react";

export default function BusinessSessionNotice() {
  const [businessDate, setBusinessDate] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const response = await fetch("/api/pos/business-session", { cache: "no-store" });
        const result = await response.json() as { session?: { businessDate: string; isCarriedOver: boolean } | null };
        if (live) setBusinessDate(response.ok && result.session?.isCarriedOver ? result.session.businessDate : null);
      } catch { /* The POS's normal requests still surface connection errors. */ }
    };
    const timer = window.setTimeout(() => { void load(); }, 0);
    const interval = window.setInterval(() => { void load(); }, 60_000);
    return () => { live = false; window.clearTimeout(timer); window.clearInterval(interval); };
  }, []);
  return businessDate ? <p className="mt-1 text-xs font-semibold text-amber-700" role="status">{businessDate} 영업이 아직 진행 중입니다. 마감 전까지 같은 영업일로 기록됩니다.</p> : null;
}
