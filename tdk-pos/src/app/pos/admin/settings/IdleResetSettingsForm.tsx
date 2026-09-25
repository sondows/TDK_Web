"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { playPosSoundTest } from "@/lib/pos-sound";

type LoginMode = "PERSONAL" | "SHARED";

export default function IdleResetSettingsForm({
  initialSeconds,
  initialLoginMode,
}: {
  initialSeconds: number;
  initialLoginMode: LoginMode;
}) {
  const router = useRouter();
  const [seconds, setSeconds] = useState(String(initialSeconds));
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [loginMode, setLoginMode] = useState<LoginMode>(initialLoginMode);
  const [savedLoginMode, setSavedLoginMode] = useState<LoginMode>(initialLoginMode);
  const [loginModeMessage, setLoginModeMessage] = useState("");
  const [savingLoginMode, setSavingLoginMode] = useState(false);

  const saveIdleReset = async () => {
    const value = Number(seconds);
    if (!Number.isSafeInteger(value) || value < 0) {
      setMessage("0 이상의 정수 초를 입력하세요.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/pos-settings/idle-reset", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seconds: value }),
      });
      const result = (await response.json()) as { success?: boolean; message?: string };
      setMessage(result.success ? "저장했습니다." : result.message ?? "설정 저장에 실패했습니다.");
    } catch {
      setMessage("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const saveLoginMode = async () => {
    setSavingLoginMode(true);
    setLoginModeMessage("");
    try {
      const response = await fetch("/api/pos-settings/login-mode", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: loginMode }),
      });
      const result = (await response.json()) as { success?: boolean; message?: string };
      if (!result.success) {
        if (response.status === 401 || response.status === 403) {
          setLoginModeMessage("관리자 인증이 필요합니다. 관리 화면에서 다시 인증해주세요.");
          router.push("/pos/admin");
        } else {
          setLoginModeMessage(result.message ?? "로그인 방식 저장에 실패했습니다.");
        }
        return;
      }
      setSavedLoginMode(loginMode);
      setLoginModeMessage("로그인 방식을 저장했습니다. 다음 POS 진입부터 적용됩니다.");
    } catch {
      setLoginModeMessage("네트워크 오류가 발생했습니다.");
    } finally {
      setSavingLoginMode(false);
    }
  };

  return (
    <div className="mx-auto mt-6 max-w-xl space-y-5">
      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold">POS 자동 초기화</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">일정 시간 조작이 없으면 현재 테이블 선택과 작성 중인 주문만 초기화합니다.</p>
        <label className="mt-6 block text-sm font-bold">자동 초기화 시간
          <span className="mt-2 flex items-center gap-2"><input className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-right font-bold" min="0" onChange={event => setSeconds(event.target.value)} step="1" type="number" value={seconds} /><span>초</span></span>
        </label>
        <p className="mt-2 text-xs text-slate-400">0초는 자동 초기화를 사용하지 않습니다.</p>
        {message && <p className="mt-4 text-sm font-medium text-blue-700">{message}</p>}
        <div className="mt-6 flex flex-wrap gap-3">
          <button className="rounded-xl border border-slate-300 bg-white px-5 py-3 font-bold text-slate-700" onClick={() => void playPosSoundTest()} type="button">효과음 테스트</button>
          <button className="rounded-xl bg-blue-600 px-5 py-3 font-bold text-white disabled:bg-slate-300" disabled={saving} onClick={() => void saveIdleReset()} type="button">{saving ? "저장 중" : "저장"}</button>
        </div>
      </section>

      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold">POS 로그인 방식</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">개인 모드는 직원코드와 PIN으로 시작합니다. 공용 모드는 POS를 바로 열고, 취소·환불 같은 민감 작업에서만 실제 직원 인증을 요구합니다.</p>
        <p className="mt-4 text-sm font-bold text-slate-700">현재 방식: {savedLoginMode === "PERSONAL" ? "개인 로그인" : "공용 로그인"}</p>
        <div className="mt-5 grid grid-cols-2 gap-4">
          {(["PERSONAL", "SHARED"] as const).map(mode => <button className={`min-h-[112px] rounded-xl border-2 p-5 text-left transition active:scale-[0.99] ${loginMode === mode ? "border-blue-600 bg-blue-50 text-blue-800" : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"}`} key={mode} onClick={() => { setLoginMode(mode); setLoginModeMessage(""); }} type="button">
            <span className="block text-lg font-bold">{mode === "PERSONAL" ? "개인 로그인" : "공용 로그인"}</span>
            <span className="mt-2 block text-sm leading-5 text-slate-500">{mode === "PERSONAL" ? "직원별 로그인 후 POS 사용" : "로그인 없이 POS 사용"}</span>
          </button>)}
        </div>
        {loginModeMessage && <p className="mt-4 text-sm font-medium text-blue-700">{loginModeMessage}</p>}
        <button className="mt-6 min-h-[64px] w-full rounded-xl bg-blue-600 px-5 py-3 text-lg font-bold text-white disabled:bg-slate-300" disabled={savingLoginMode || loginMode === savedLoginMode} onClick={() => void saveLoginMode()} type="button">{savingLoginMode ? "저장 중" : "로그인 방식 저장"}</button>
      </section>
    </div>
  );
}
