"use client";

import { useEffect, useRef, useState } from "react";
import StaffToggle from "@/app/admin/staff/StaffToggle";
import { DEFAULT_KDS_ARRIVAL_SOUND_SETTINGS, scheduleKdsArrivalSound, type KdsArrivalSoundKey, type KdsArrivalSoundSettings } from "@/lib/kds-arrival-sound";

const soundNames: Record<KdsArrivalSoundKey, string> = { default: "기본음", bell: "벨", chime: "차임" };

export default function KdsArrivalSoundForm({ initial }: { initial: KdsArrivalSoundSettings }) {
  const [settings, setSettings] = useState(initial ?? DEFAULT_KDS_ARRIVAL_SOUND_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [message, setMessage] = useState("");
  const contextRef = useRef<AudioContext | null>(null);
  const scheduledNodes = useRef<OscillatorNode[]>([]);
  const previewTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
    for (const node of scheduledNodes.current) {
      try { node.stop(); } catch { /* already stopped */ }
    }
    void contextRef.current?.close();
  }, []);

  function stopPreview() {
    if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
    previewTimer.current = null;
    for (const node of scheduledNodes.current) {
      try { node.stop(); } catch { /* already stopped */ }
    }
    scheduledNodes.current = [];
    setPreviewing(false);
  }

  async function preview() {
    stopPreview();
    const AudioContextConstructor = window.AudioContext;
    if (!AudioContextConstructor) { setMessage("이 브라우저에서는 도착음을 재생할 수 없습니다."); return; }
    try {
      contextRef.current ??= new AudioContextConstructor();
      await contextRef.current.resume();
      scheduledNodes.current = scheduleKdsArrivalSound(contextRef.current, settings.soundKey, 1);
      setPreviewing(true);
      previewTimer.current = window.setTimeout(() => setPreviewing(false), 900);
    } catch {
      setMessage("미리듣기를 시작하지 못했습니다.");
    }
  }

  async function save() {
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/admin/kds-arrival-sound", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings),
      });
      const result = await response.json() as { success?: boolean; message?: string; settings?: KdsArrivalSoundSettings };
      if (!response.ok || !result.success || !result.settings) throw new Error(result.message ?? "설정 저장에 실패했습니다.");
      setSettings(result.settings);
      setMessage("KDS 도착음 설정을 저장했습니다. 열려 있는 KDS에는 다음 polling부터 반영됩니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "설정 저장에 실패했습니다.");
    } finally { setSaving(false); }
  }

  return <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 className="text-lg font-bold text-slate-800">KDS 신규 주문 도착음</h2>
    <p className="mt-1 text-sm text-slate-600">매장 공통 도착음 정책입니다. Android/Chrome에서는 각 태블릿에서 알림음을 한 번 켜야 재생할 수 있습니다.</p>
    <div className="mt-5 space-y-5">
      <StaffToggle checked={settings.enabled} label="도착음 사용" onChange={enabled => setSettings(current => ({ ...current, enabled }))} variant="customer" />
      <label className="block text-sm font-semibold text-slate-700">도착음
        <select className="mt-1 block h-10 w-full rounded border border-slate-300 bg-white px-3" onChange={event => setSettings(current => ({ ...current, soundKey: event.target.value as KdsArrivalSoundKey }))} value={settings.soundKey}>
          {Object.entries(soundNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
        </select>
      </label>
      <label className="block text-sm font-semibold text-slate-700">반복
        <select className="mt-1 block h-10 w-full rounded border border-slate-300 bg-white px-3" onChange={event => setSettings(current => ({ ...current, repeat: Number(event.target.value) as KdsArrivalSoundSettings["repeat"] }))} value={settings.repeat}>
          {[1, 2, 3].map(value => <option key={value} value={value}>{value}회</option>)}
        </select>
      </label>
    </div>
    {message && <p className="mt-4 text-sm text-slate-700" role="status">{message}</p>}
    <div className="mt-5 flex flex-wrap gap-3">
      <button className="min-h-10 rounded border border-slate-300 bg-white px-4 font-semibold text-slate-700 hover:bg-slate-50" onClick={() => void preview()} type="button">{previewing ? "▶ 재생 중" : "▶ 미리듣기"}</button>
      <button className="min-h-10 rounded bg-slate-700 px-4 font-semibold text-white hover:bg-slate-800 disabled:opacity-50" disabled={saving} onClick={() => void save()} type="button">{saving ? "저장 중" : "저장"}</button>
    </div>
  </section>;
}
