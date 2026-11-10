"use client";

import { createContext, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { resolveAdmIdStatus, transitionAuthPhase, type AuthEvent, type AuthPhase } from "@/lib/program-auth-flow";
import { checkMasterRecoveryId, masterRecoveryActionLabel } from "@/lib/master-recovery-client";
import PosTouchKeyboard, { type PosKeyboardMode } from "@/components/PosTouchKeyboard";

type Program = "POS" | "ADM" | "KDS" | "HOS";
type PosKeyboardTarget = "loginId" | "password" | "confirmPassword" | "pin" | "pinConfirm" | "recoveryPassword" | "recoveryConfirm";
type TrustStatus = { trusted?: boolean; invalidated?: boolean; pinSetupRequired?: boolean;
  passwordRegistrationRequired?: boolean; masterPasswordConfigured?: boolean; loginId?: string };
type RecoveryStatus = { available?: boolean; loginId?: string; passwordConfigured?: boolean };
type ApiResult = { success?: boolean; code?: string; message?: string; pinSetupRequired?: boolean;
  sessionCreated?: boolean; passwordChangeRequired?: boolean; passwordRegistrationRequired?: boolean };
export const ProgramAuthContext = createContext<{
  loginId: string;
  setLoginId: (value: string) => void;
} | null>(null);
const endpoints: Record<Program, string> = {
  POS: "/api/auth/trust", ADM: "/api/admin-center/trust", KDS: "/api/kitchen/auth/trust", HOS: "/api/hos/auth/trust",
};
const loginPath: Record<Program, string> = {
  POS: "/tdkpos/login", ADM: "/tdkadm/login", KDS: "/tdkkds", HOS: "/tdkhos",
};
const homePath: Record<Program, string> = {
  POS: "/tdkpos", ADM: "/tdkadm", KDS: "/tdkkds", HOS: "/tdkhos",
};
const inputStyle = "mt-2 min-h-14 w-full rounded-xl border border-slate-300 px-4 disabled:bg-slate-100";
const meetsMasterPasswordPolicy = (value: string) => value.length >= 10 && value.length <= 128 &&
  /[A-Za-z]/.test(value) && /[0-9]/.test(value) && /[^A-Za-z0-9\s]/.test(value);

export default function ProgramTrustGate({ program, children }: { program: Program; children: ReactNode }) {
  const [phase, setPhase] = useState<AuthPhase>("CHECKING");
  const [verifiedToken, setVerifiedToken] = useState(false);
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisibility, setPasswordVisibility] = useState<{ phase: AuthPhase; visible: boolean }>({
    phase: "CHECKING", visible: false,
  });
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [pinReset, setPinReset] = useState(false);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [recoveryToken, setRecoveryToken] = useState("");
  const [recoveryPasswordConfigured, setRecoveryPasswordConfigured] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [recoveryConfirm, setRecoveryConfirm] = useState("");
  const [recoveryError, setRecoveryError] = useState("");
  const [initialPasswordRegistration, setInitialPasswordRegistration] = useState(false);
  const [activeKeyboard, setActiveKeyboard] = useState<PosKeyboardMode | null>(null);
  const [keyboardTarget, setKeyboardTarget] = useState<PosKeyboardTarget>("loginId");
  const recoveryDialog = useRef<HTMLDialogElement>(null);
  const loginForm = useRef<HTMLFormElement>(null);
  const recoveryForm = useRef<HTMLFormElement>(null);
  const idInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const pinInput = useRef<HTMLInputElement>(null);
  const recoveryTokenRef = useRef("");
  const submitLock = useRef(false);
  const recoverySubmitLock = useRef(false);
  const checkSerial = useRef(0);
  const admIdRequestSerial = useRef(0);
  const admIdSubmitLock = useRef(false);
  const kdsIdSubmitLock = useRef(false);
  const posIdSubmitLock = useRef(false);
  const endpoint = endpoints[program];
  const advance = useCallback((event: AuthEvent) =>
    setPhase(current => transitionAuthPhase(current, event)), []);

  const updateKeyboardTarget = (update: (current: string) => string) => {
    if (keyboardTarget === "loginId") setLoginId(current => update(current).slice(0, 32));
    else if (keyboardTarget === "password") setPassword(current => update(current).slice(0, 128));
    else if (keyboardTarget === "confirmPassword") setConfirmPassword(current => update(current).slice(0, 128));
    else if (keyboardTarget === "pin") setPin(current => update(current).replace(/\D/g, "").slice(0, 6));
    else if (keyboardTarget === "pinConfirm") setPinConfirm(current => update(current).replace(/\D/g, "").slice(0, 6));
    else if (keyboardTarget === "recoveryPassword") setRecoveryPassword(current => update(current).slice(0, 128));
    else setRecoveryConfirm(current => update(current).slice(0, 128));
  };
  const keyboardText = (text: string) => updateKeyboardTarget(current => current + text);
  const keyboardBackspace = () => updateKeyboardTarget(current => Array.from(current).slice(0, -1).join(""));
  const keyboardClear = () => updateKeyboardTarget(() => "");
  const openPosKeyboard = (target: PosKeyboardTarget, mode: PosKeyboardMode) => {
    if (program !== "POS") return;
    setKeyboardTarget(target);
    setActiveKeyboard(mode);
  };

  useEffect(() => {
    if (!activeKeyboard || program !== "POS") return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) ||
        (!target.closest("[data-pos-touch-keyboard]") && !target.closest("[data-pos-touch-input]")))
        setActiveKeyboard(null);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [activeKeyboard, program]);

  const checkInitialState = useCallback(async () => {
    const serial = ++checkSerial.current;
    setPhase("CHECKING"); setMessage(""); setNotice("");
    setRecoveryPasswordConfigured(false);
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const fragmentToken = program === "ADM" ? fragment.get("master-recovery") ?? "" : "";
    if (fragmentToken) recoveryTokenRef.current = fragmentToken;
    const suppliedToken = fragmentToken || recoveryTokenRef.current;
    const recoveryRequested = program === "ADM" &&
      (Boolean(fragmentToken) || new URLSearchParams(window.location.search).has("recovery"));
    if (suppliedToken) window.history.replaceState(null, "", window.location.pathname + window.location.search);
    if (recoveryRequested) {
      try {
        const response = await fetch("/api/program-trust/master-recovery/status", {
          method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
          body: JSON.stringify({ token: suppliedToken }),
        });
        const result = await response.json() as RecoveryStatus;
        if (serial !== checkSerial.current) return;
        if (!response.ok || !result.available || !result.loginId) {
          setMessage(response.status === 429 ? "복구 상태 확인 요청이 많습니다. 잠시 후 다시 시도해 주세요." :
            "복구 링크가 만료됐거나 유효하지 않습니다. NAS 관리자에게 새 링크를 요청해 주세요.");
          advance({ type: "RECOVERY_FAILED" }); return;
        }
        setRecoveryToken(suppliedToken);
        setLoginId(result.loginId); setPassword(""); setVerifiedToken(false);
        advance({ type: "RECOVERY_GRANTED" });
      } catch {
        if (serial !== checkSerial.current) return;
        setMessage("복구 상태를 확인할 수 없습니다. 연결을 확인한 뒤 다시 시도해 주세요.");
        advance({ type: "RECOVERY_FAILED" });
      }
      return;
    }
    if (program === "ADM") {
      setRecoveryToken(""); setVerifiedToken(false);
      setPhase("LOGIN_ID");
      return;
    }
    if (program === "KDS" || program === "HOS") {
      setRecoveryToken(""); setVerifiedToken(false); setLoginId(""); setPassword("");
      setPhase("LOGIN_ID");
      return;
    }
    if (program === "POS") {
      setRecoveryToken(""); setVerifiedToken(false); setLoginId(""); setPassword("");
      setPin(""); setPinConfirm(""); setPhase("LOGIN_ID");
      return;
    }
    try {
      const trustResponse = await fetch(endpoint, { cache: "no-store" });
      const trust = await trustResponse.json() as TrustStatus;
      if (serial !== checkSerial.current) return;
      if (!trustResponse.ok) throw new Error("Trust status unavailable");
      setRecoveryToken(""); setVerifiedToken(Boolean(trust.trusted));
      if (trust.loginId) setLoginId(trust.loginId);
      if (trust.invalidated) setNotice("저장된 보안 인증이 무효화됐습니다. 다시 인증해 주세요.");
      advance({ type: "TRUST_CHECKED", trusted: Boolean(trust.trusted),
        pinSetupRequired: Boolean(trust.pinSetupRequired), bootstrapAvailable: false });
    } catch {
      if (serial !== checkSerial.current) return;
      setMessage("인증 상태를 확인할 수 없습니다.");
      advance({ type: "CHECK_FAILED" });
    }
  }, [program, endpoint, advance]);

  useEffect(() => {
    const refresh = () => { void checkInitialState(); };
    const requestSerial = checkSerial;
    refresh();
    window.addEventListener("hashchange", refresh);
    const pageShow = (event: PageTransitionEvent) => { if (event.persisted) refresh(); };
    window.addEventListener("pageshow", pageShow);
    return () => {
      requestSerial.current++;
      window.removeEventListener("hashchange", refresh);
      window.removeEventListener("pageshow", pageShow);
    };
  }, [checkInitialState]);
  useEffect(() => {
    const requireTrust = () => {
      setVerifiedToken(false); setPassword(""); setMessage("");
      advance({ type: "TRUST_REQUIRED" });
    };
    const authenticated = () => advance({ type: "PIN_AUTHENTICATED" });
    window.addEventListener("tdk-program-trust-required", requireTrust);
    window.addEventListener("tdk-program-authenticated", authenticated);
    return () => {
      window.removeEventListener("tdk-program-trust-required", requireTrust);
      window.removeEventListener("tdk-program-authenticated", authenticated);
    };
  }, [advance]);
  useEffect(() => {
    const dialog = recoveryDialog.current;
    if (!dialog) return;
    if (recoveryOpen && !dialog.open) dialog.showModal();
    if (!recoveryOpen && dialog.open) dialog.close();
  }, [recoveryOpen]);

  const confirmRecoveryId = async () => {
    if (busy || phase !== "RECOVERY_ID") return;
    const normalizedId = loginId.trim().toLowerCase();
    if (!/^[a-z][a-z0-9._-]{2,31}$/.test(normalizedId)) {
      if (loginId.trim()) setMessage("ID를 확인해 주세요.");
      return;
    }
    setBusy(true); setMessage("");
    try {
      const result = await checkMasterRecoveryId(normalizedId, recoveryToken);
      if (!result.confirmed) {
        setMessage(result.rateLimited ? "복구 상태 확인 요청이 많습니다. 잠시 후 다시 시도해 주세요." :
          "복구 권한과 ID를 확인해 주세요.");
        return;
      }
      setLoginId(normalizedId);
      setRecoveryPasswordConfigured(result.passwordConfigured);
      setInitialPasswordRegistration(false);
      advance({ type: "RECOVERY_ID_CONFIRMED" });
    } catch { setMessage("복구 상태를 확인할 수 없습니다. 연결을 확인한 뒤 다시 시도해 주세요."); }
    finally { setBusy(false); }
  };

  const checkAdmId = async () => {
    if (program !== "ADM" || busy || admIdSubmitLock.current || phase !== "LOGIN_ID") return;
    const normalizedId = loginId.trim().toLowerCase();
    if (!/^[a-z][a-z0-9._-]{2,31}$/.test(normalizedId)) {
      setMessage("ID를 확인해 주세요.");
      return;
    }
    admIdSubmitLock.current = true;
    const serial = ++admIdRequestSerial.current;
    setBusy(true); setMessage("");
    try {
      const trustUrl = new URL(endpoint, window.location.origin);
      trustUrl.searchParams.set("loginId", normalizedId);
      const [trustResponse, bootstrapResponse, setupResponse] = await Promise.all([
        fetch(trustUrl, { cache: "no-store" }),
        fetch("/api/admin-center/trust/initialize", { cache: "no-store" }),
        fetch("/api/admin-center/trust/initial-master/status", {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ loginId: normalizedId }),
        }),
      ]);
      const trust = await trustResponse.json() as TrustStatus;
      const bootstrap = bootstrapResponse.ok ?
        await bootstrapResponse.json() as { available?: boolean } : null;
      const setup = setupResponse.ok ?
        await setupResponse.json() as { state?: string; available?: boolean; accountFound?: boolean;
          passwordConfigured?: boolean | null; resetPasswordRequired?: boolean } : null;
      if (serial !== admIdRequestSerial.current ||
        idInput.current?.value.trim().toLowerCase() !== normalizedId) return;
      if (!trustResponse.ok || !bootstrapResponse.ok ||
        (!setupResponse.ok && setupResponse.status !== 403)) {
        setMessage(setupResponse.status === 429
          ? "계정 상태 조회 요청이 많습니다. 잠시 후 다시 시도해 주세요."
          : "계정 상태를 확인할 수 없습니다. 다시 시도해 주세요.");
        return;
      }
      setLoginId(normalizedId); setPassword("");
      const decision = resolveAdmIdStatus({
        trusted: Boolean(trust.trusted),
        pinSetupRequired: Boolean(trust.pinSetupRequired),
        bootstrapAvailable: Boolean(bootstrap?.available),
        setupHttpStatus: setupResponse.status,
        resetPasswordRequired: setup?.resetPasswordRequired,
        state: setup?.state,
        available: setup?.available,
        passwordConfigured: setup?.passwordConfigured,
      });
      if (decision === "LOGIN_PIN" || decision === "SETUP_PIN") {
        setVerifiedToken(true);
        setPhase(decision);
        return;
      }
      setVerifiedToken(false);
      if (decision === "BOOTSTRAP_SETUP") {
        setPhase("BOOTSTRAP_SETUP");
        return;
      }
      if (decision === "REGISTER_PASSWORD") {
        setInitialPasswordRegistration(true);
        setRecoveryPassword(""); setRecoveryConfirm(""); setRecoveryError("");
        setRecoveryOpen(true);
        return;
      }
      if (decision === "LOGIN_PASSWORD") {
        setPhase("LOGIN_PASSWORD");
        return;
      }
      if (process.env.NODE_ENV !== "production") console.warn("ADM account-status response was not recognized", {
        trustStatus: trustResponse.status, bootstrapStatus: bootstrapResponse.status,
        setupStatus: setupResponse.status, setupState: setup?.state ?? null,
        resetPasswordRequired: setup?.resetPasswordRequired ?? null,
      });
      setMessage(decision === "REGISTRATION_NOT_ALLOWED"
        ? "마스터 비밀번호가 등록되지 않았지만 이 계정에는 최초 등록 권한이 없습니다. NAS 관리자에게 요청해 주세요."
        : decision === "ACCOUNT_UNAVAILABLE"
          ? "사용할 수 없는 ADM 계정입니다. 관리자에게 계정 상태를 확인해 주세요."
          : "계정 상태를 확인할 수 없습니다. ID를 확인하거나 관리자에게 문의해 주세요.");
    } catch {
      if (serial === admIdRequestSerial.current)
        setMessage("계정 상태를 확인할 수 없습니다. 연결을 확인한 뒤 다시 시도해 주세요.");
    } finally {
      if (serial === admIdRequestSerial.current) {
        setBusy(false);
        admIdSubmitLock.current = false;
      }
    }
  };

  const checkKdsId = async () => {
    if ((program !== "KDS" && program !== "HOS") || busy || kdsIdSubmitLock.current || phase !== "LOGIN_ID") return;
    const normalizedId = loginId.trim().toLowerCase();
    if (!/^[a-z][a-z0-9._-]{2,31}$/.test(normalizedId)) {
      setMessage("ID를 확인해 주세요.");
      return;
    }
    kdsIdSubmitLock.current = true;
    const serial = ++admIdRequestSerial.current;
    setBusy(true); setMessage("");
    try {
      const url = new URL(endpoint, window.location.origin);
      url.searchParams.set("loginId", normalizedId);
      const response = await fetch(url, { cache: "no-store" });
      const result = await response.json() as TrustStatus & { success?: boolean; message?: string };
      if (serial !== admIdRequestSerial.current || idInput.current?.value.trim().toLowerCase() !== normalizedId) return;
      if (!response.ok || result.success === false) {
        setMessage(response.status === 429 || response.status === 503 ? result.message ?? "KDS 로그인 요청을 확인할 수 없습니다." :
          result.message ?? "KDS 계정 정보를 확인할 수 없습니다. ID를 확인해 주세요.");
        return;
      }
      setLoginId(normalizedId); setPassword(""); setVerifiedToken(Boolean(result.trusted));
      setPin(""); setPinConfirm(""); setMessage(""); setNotice("");
      if (result.trusted) {
        setPhase(result.pinSetupRequired ? "SETUP_PIN" : "LOGIN_PIN");
        return;
      }
      if (result.passwordRegistrationRequired) {
        setInitialPasswordRegistration(true);
        setRecoveryPassword(""); setRecoveryConfirm(""); setRecoveryError("");
        setRecoveryOpen(true);
        return;
      }
      try {
        const setupUrl = new URL("/api/admin-center/trust/initial-master/status", window.location.origin);
        setupUrl.searchParams.set("program", program);
        const setupResponse = await fetch(setupUrl, {
          method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
          body: JSON.stringify({ loginId: normalizedId }),
        });
        if (!setupResponse.ok && (setupResponse.status === 429 || setupResponse.status === 503)) {
          const setupFailure = await setupResponse.json() as { code?: string; message?: string };
          if (setupFailure.code?.startsWith("KDS_") || setupFailure.code === "CLIENT_IP_UNAVAILABLE") {
            setMessage(setupFailure.message ?? "KDS 로그인 요청을 확인할 수 없습니다.");
            return;
          }
        }
        if (setupResponse.ok) {
          const setup = await setupResponse.json() as { state?: string; available?: boolean };
          if (setup.available && setup.state === "MASTER_PASSWORD_REQUIRED") {
            setInitialPasswordRegistration(true);
            setRecoveryPassword(""); setRecoveryConfirm(""); setRecoveryError("");
            setRecoveryOpen(true);
            return;
          }
        }
      } catch {
        // Initial setup is optional; normal KDS password authentication remains available.
      }
      setPhase("LOGIN_PASSWORD");
    } catch {
      if (serial === admIdRequestSerial.current) setMessage("서버 연결을 확인한 뒤 다시 시도해 주세요.");
    } finally {
      if (serial === admIdRequestSerial.current) {
        setBusy(false);
        kdsIdSubmitLock.current = false;
      }
    }
  };

  const checkPosId = async () => {
    if (program !== "POS" || busy || posIdSubmitLock.current || phase !== "LOGIN_ID") return;
    const normalizedId = loginId.trim().toLowerCase();
    if (!/^[a-z][a-z0-9._-]{2,31}$/.test(normalizedId)) {
      setMessage("ID를 확인해 주세요.");
      return;
    }
    posIdSubmitLock.current = true;
    const serial = ++admIdRequestSerial.current;
    setBusy(true); setMessage("");
    try {
      const trustUrl = new URL(endpoint, window.location.origin);
      trustUrl.searchParams.set("loginId", normalizedId);
      const response = await fetch(trustUrl, { cache: "no-store" });
      const trust = await response.json() as TrustStatus & { success?: boolean; message?: string };
      if (serial !== admIdRequestSerial.current ||
        idInput.current?.value.trim().toLowerCase() !== normalizedId) return;
      if (!response.ok || trust.success === false) {
        setMessage(trust.message ?? "등록된 ID를 확인할 수 없습니다. ID를 다시 확인해 주세요.");
        return;
      }
      setLoginId(normalizedId); setPassword(""); setPin(""); setPinConfirm(""); setNotice("");
      setVerifiedToken(Boolean(trust.trusted));
      if (trust.trusted) {
        setActiveKeyboard(null);
        setPhase(trust.pinSetupRequired ? "SETUP_PIN" : "LOGIN_PIN");
        return;
      }
      if (trust.invalidated) {
        setNotice("이 브라우저의 저장된 기기 인증이 현재 ID에 유효하지 않습니다. 마스터 비밀번호 인증이 필요합니다.");
      }
      if (trust.passwordRegistrationRequired) {
        setActiveKeyboard(null);
        setInitialPasswordRegistration(true);
        setRecoveryPassword(""); setRecoveryConfirm(""); setRecoveryError("");
        setRecoveryOpen(true);
        return;
      }
      if (trust.masterPasswordConfigured) {
        setActiveKeyboard(null);
        setPhase("LOGIN_PASSWORD");
        return;
      }

      const setupUrl = new URL("/api/admin-center/trust/initial-master/status", window.location.origin);
      setupUrl.searchParams.set("program", "POS");
      const setupResponse = await fetch(setupUrl, { method: "POST",
        headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ loginId: normalizedId }) });
      const setup = setupResponse.ok ? await setupResponse.json() as {
        state?: string; available?: boolean; resetPasswordRequired?: boolean;
      } : null;
      if (serial !== admIdRequestSerial.current) return;
      if (setup?.resetPasswordRequired || (setup?.available && setup.state === "MASTER_PASSWORD_REQUIRED")) {
        setActiveKeyboard(null);
        setInitialPasswordRegistration(true);
        setRecoveryPassword(""); setRecoveryConfirm(""); setRecoveryError("");
        setRecoveryOpen(true);
        return;
      }
      setMessage(setupResponse.status === 429 || setupResponse.status === 503
        ? "최초 설정 상태를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요."
        : "마스터 비밀번호가 등록되지 않았습니다. 승인된 초기 설정 절차를 진행해 주세요.");
    } catch {
      if (serial === admIdRequestSerial.current) setMessage("계정 상태를 확인할 수 없습니다. 연결을 확인해 주세요.");
    } finally {
      if (serial === admIdRequestSerial.current) {
        setBusy(false);
        posIdSubmitLock.current = false;
      }
    }
  };

  useEffect(() => {
    if (program !== "ADM" || phase !== "LOGIN_ID") return;
    const syncPrefilledId = () => {
      const input = idInput.current;
      if (!input || document.activeElement === input) return;
      const value = input.value || loginId;
      if (!value) return;
      if (value !== loginId) setLoginId(value);
    };
    const timers = [0, 250, 1000].map(delay => window.setTimeout(syncPrefilledId, delay));
    return () => timers.forEach(window.clearTimeout);
  }, [program, phase, loginId]);

  useEffect(() => {
    if ((program === "ADM" || program === "KDS" || program === "HOS") && phase === "LOGIN_PASSWORD") passwordInput.current?.focus();
  }, [program, phase]);
  useEffect(() => {
    if (program === "POS" && phase === "LOGIN_ID") idInput.current?.focus();
  }, [program, phase]);
  useEffect(() => {
    if (program === "POS" && phase === "LOGIN_PASSWORD") passwordInput.current?.focus();
  }, [program, phase]);
  useEffect(() => {
    if ((program === "KDS" || program === "HOS") && phase === "LOGIN_ID") idInput.current?.focus();
  }, [program, phase]);
  useEffect(() => {
    if ((program === "POS" || program === "KDS" || program === "HOS") && phase === "SETUP_PIN") pinInput.current?.focus();
  }, [program, phase]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitLock.current) return;
    submitLock.current = true;
    void submitCurrent(event).finally(() => { submitLock.current = false; });
  };

  const submitCurrent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (phase === "LOGIN_ID") {
      if (program === "ADM") await checkAdmId();
      else if (program === "KDS" || program === "HOS") await checkKdsId();
      else if (program === "POS") await checkPosId();
      return;
    }
    if (phase === "RECOVERY_ID") { await confirmRecoveryId(); return; }
    if (phase === "SETUP_PASSWORD") {
      setRecoveryPassword(""); setRecoveryConfirm(""); setRecoveryError(""); setRecoveryOpen(true); return;
    }
    if ((phase === "BOOTSTRAP_SETUP" || phase === "CHANGE_TEMPORARY_PASSWORD") &&
      password !== confirmPassword) { setMessage("비밀번호가 일치하지 않습니다."); return; }
    if (phase === "SETUP_PIN" && pin !== pinConfirm) { setMessage("PIN이 일치하지 않습니다."); return; }
    if (phase !== "LOGIN_PASSWORD" && phase !== "SETUP_PIN" && phase !== "BOOTSTRAP_SETUP" &&
      phase !== "CHANGE_TEMPORARY_PASSWORD") return;
    setBusy(true); setMessage(""); setNotice("");
    try {
      const normalizedId = loginId.trim().toLowerCase();
      const standalone = window.matchMedia("(display-mode: standalone)").matches ||
        ("standalone" in window.navigator && Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone));
      let url = endpoint;
      let payload: Record<string, unknown>;
      if (phase === "SETUP_PIN") {
        url = "/api/program-trust/pin";
        payload = { program, loginId: normalizedId, password, pin, confirmPin: pinConfirm, reset: pinReset };
      } else if (phase === "BOOTSTRAP_SETUP") {
        url = "/api/admin-center/trust/initialize";
        payload = { loginId: normalizedId, password, confirmPassword };
      } else if (phase === "CHANGE_TEMPORARY_PASSWORD") {
        url = "/api/program-trust/change-temporary-password";
        payload = { program, loginId: normalizedId, temporaryPassword,
          newPassword: password, confirmPassword };
      } else {
        payload = { loginId: normalizedId, password, standalone };
      }
      const response = await fetch(url, { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json() as ApiResult;
      if (!response.ok || !result.success) {
        if (result.code === "PIN_SETUP_REAUTH_REQUIRED") {
          setActiveKeyboard(null);
          setPin(""); setPinConfirm(""); setPinReset(false); setPassword(""); setPhase("LOGIN_PASSWORD");
          setMessage("마스터 비밀번호로 다시 인증한 뒤 PIN을 설정해 주세요."); return;
        }
        setMessage(result.code?.startsWith("KDS_") || response.status === 503 ? result.message ?? "KDS 인증 요청을 확인할 수 없습니다."
          : response.status === 429 ? "인증 시도가 많습니다. 15분 후 다시 시도해 주세요."
          : result.message ?? "인증을 완료하지 못했습니다.");
        if (phase === "SETUP_PIN") { setPin(""); setPinConfirm(""); }
        return;
      }
      if (program === "POS") setActiveKeyboard(null);
      if (phase === "LOGIN_PASSWORD") {
        if (result.passwordRegistrationRequired) {
          setInitialPasswordRegistration(true);
          setRecoveryPassword(""); setRecoveryConfirm(""); setRecoveryError("");
          setRecoveryOpen(true);
          return;
        }
        if (result.passwordChangeRequired) {
          setTemporaryPassword(password); setPassword(""); setConfirmPassword("");
          advance({ type: "TEMPORARY_PASSWORD_REQUIRED" }); return;
        }
        setPassword(""); setVerifiedToken(true);
        advance({ type: "PASSWORD_VERIFIED", pinSetupRequired: Boolean(result.pinSetupRequired) });
      } else if (phase === "SETUP_PIN") {
        setPin(""); setPinConfirm(""); setPinReset(false); setPassword("");
        if (result.sessionCreated) {
          advance({ type: "PIN_AUTHENTICATED" }); window.location.assign(homePath[program]);
        } else setPhase("LOGIN_PIN");
      } else {
        setPassword(""); setConfirmPassword(""); setTemporaryPassword("");
        window.history.replaceState(null, "", loginPath[program]);
        advance({ type: phase === "BOOTSTRAP_SETUP" ? "BOOTSTRAP_COMPLETED" : "TEMPORARY_PASSWORD_CHANGED" });
        setNotice("마스터 비밀번호가 설정됐습니다. ID와 새 비밀번호로 인증해 주세요.");
      }
    } catch { setMessage("네트워크 오류가 발생했습니다. 다시 시도해 주세요."); }
    finally { setBusy(false); }
  };

  const submitRecovery = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (recoverySubmitLock.current) return;
    recoverySubmitLock.current = true;
    void submitRecoveryCurrent(event).finally(() => { recoverySubmitLock.current = false; });
  };

  const submitRecoveryCurrent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || (!initialPasswordRegistration && phase !== "SETUP_PASSWORD")) return;
    if (recoveryPassword !== recoveryConfirm) { setRecoveryError("비밀번호가 일치하지 않습니다."); return; }
    if (!meetsMasterPasswordPolicy(recoveryPassword)) {
      setRecoveryError("마스터 비밀번호는 10자 이상이며 영문·숫자·특수문자를 포함해야 합니다."); return;
    }
    setBusy(true); setRecoveryError("");
    try {
      const registrationUrl = new URL(initialPasswordRegistration ?
        "/api/program-trust/master-recovery/register-initial" :
        "/api/program-trust/master-recovery/register", window.location.origin);
      if (initialPasswordRegistration && (program === "KDS" || program === "POS" || program === "HOS"))
        registrationUrl.searchParams.set("program", program);
      const response = await fetch(registrationUrl, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId: loginId.trim().toLowerCase(), token: recoveryToken,
          password: recoveryPassword, confirmPassword: recoveryConfirm }),
      });
      const result = await response.json() as ApiResult;
      if (!response.ok || !result.success) {
        setRecoveryError(result.message ?? "마스터 비밀번호를 등록하지 못했습니다."); return;
      }
      if (initialPasswordRegistration) {
        setRecoveryOpen(false); setRecoveryToken(""); setRecoveryPassword(""); setRecoveryConfirm("");
        recoveryTokenRef.current = "";
        setPassword(""); setVerifiedToken(false); setInitialPasswordRegistration(false);
        const url = new URL(window.location.href);
        url.searchParams.delete("recovery");
        window.history.replaceState(null, "", url.pathname + url.search);
        setPhase("LOGIN_PASSWORD");
        setNotice("마스터 비밀번호가 등록됐습니다. 새 비밀번호로 인증해 주세요.");
        return;
      }
      setRecoveryOpen(false); setRecoveryToken(""); setRecoveryPassword(""); setRecoveryConfirm("");
      recoveryTokenRef.current = "";
      setPassword(""); setVerifiedToken(false);
      const url = new URL(window.location.href);
      url.searchParams.delete("recovery");
      window.history.replaceState(null, "", url.pathname + url.search);
      advance({ type: "PASSWORD_REGISTERED" });
      setNotice(recoveryPasswordConfigured ?
        "마스터 비밀번호가 재설정됐습니다. 새 비밀번호로 인증해 주세요." :
        "마스터 비밀번호가 등록됐습니다. 새 비밀번호로 인증해 주세요.");
    } catch { setRecoveryError("네트워크 오류가 발생했습니다. 다시 시도해 주세요."); }
    finally { setBusy(false); }
  };

  const statusLabel = verifiedToken ? "인증" : phase === "CHECKING" ? "확인 중" : "미인증";
  const status = <div className="fixed right-3 top-3 z-50 flex items-center gap-2 rounded-lg bg-white/95 px-2 py-1 text-xs font-semibold text-slate-600 shadow-sm">
    <span aria-live="polite">보안 {statusLabel}</span>
    {phase === "LOGIN_PIN" && <button className="text-blue-700 underline" onClick={() => {
      setPassword(""); setPhase("LOGIN_PASSWORD");
    }} type="button">다른 직원 인증</button>}
    {(program === "KDS" || program === "HOS") && phase === "LOGIN_PIN" && <button className="text-blue-700 underline" onClick={() => {
      setPassword(""); setPin(""); setMessage(""); setVerifiedToken(false); setPhase("LOGIN_ID");
    }} type="button">ID 변경</button>}
    {phase === "LOGIN_PIN" && <button className="text-blue-700 underline" onClick={() => {
      setPassword(""); setPin(""); setPinConfirm(""); setPinReset(true);
      advance({ type: "PIN_CHANGE_REQUESTED" });
    }} type="button">PIN 변경</button>}
  </div>;
  if (phase === "LOGIN_PIN") return <ProgramAuthContext.Provider value={{ loginId, setLoginId }}>
    {status}
    {program === "ADM" && <button className="fixed left-3 top-3 z-50 rounded-lg bg-white/95 px-3 py-1 text-xs font-semibold text-blue-700 shadow-sm"
      onClick={() => { setPassword(""); setPin(""); setPinConfirm(""); setMessage(""); setNotice("");
        setVerifiedToken(false); setPhase("LOGIN_ID"); }} type="button">ID 변경</button>}
    {children}
  </ProgramAuthContext.Provider>;
  if (phase === "AUTHENTICATED") return <>{status}<main className="flex min-h-dvh items-center justify-center bg-slate-100">로그인 중…</main></>;
  const title = phase === "SETUP_PIN" ? pinReset ? "개인 PIN 변경" : "개인 PIN 등록" :
    phase === "RECOVERY_ID" ? "계정 확인" :
    phase === "BOOTSTRAP_SETUP" ? "최고관리자 최초 등록" :
        phase === "CHANGE_TEMPORARY_PASSWORD" ? "마스터 비밀번호 변경" :
          program === "ADM" && (phase === "LOGIN_ID" || phase === "LOGIN_PASSWORD") ?
            "관리센터 로그온" : program === "POS" ? "POS 로그인" :
              program === "KDS" ? "KDS 로그인" : program === "HOS" ? "TDK HOS" : `${program} 최초 인증`;
  const showId = true;
  const showPassword = phase === "LOGIN_PASSWORD" || phase === "SETUP_PASSWORD" ||
    phase === "BOOTSTRAP_SETUP" || phase === "CHANGE_TEMPORARY_PASSWORD";
  const disabled = busy || !loginId.trim() ||
    (phase === "LOGIN_PASSWORD" && (program === "POS" ? !password : password.length < 10)) ||
    (phase === "SETUP_PIN" && (pin.length !== 6 || pin !== pinConfirm || (pinReset && password.length < 10))) ||
    (phase === "BOOTSTRAP_SETUP" && (password.length < 10 || password !== confirmPassword)) ||
    (phase === "CHANGE_TEMPORARY_PASSWORD" && (password.length < 10 || password !== confirmPassword));
  const buttonText = busy ? "확인 중…" : phase === "LOGIN_ID" ? "다음" :
    phase === "RECOVERY_ID" ? "계정 상태 확인" :
    phase === "SETUP_PASSWORD" ? masterRecoveryActionLabel(recoveryPasswordConfigured) :
    phase === "SETUP_PIN" ? pinReset ? "PIN 변경" : "PIN 등록" :
      phase === "BOOTSTRAP_SETUP" ? "최고관리자 등록" :
        phase === "CHANGE_TEMPORARY_PASSWORD" ? "비밀번호 설정" : "인증";
  const passwordVisible = passwordVisibility.phase === phase && passwordVisibility.visible;
  const loginKeyboardOpen = program === "POS" && activeKeyboard !== null &&
    keyboardTarget !== "recoveryPassword" && keyboardTarget !== "recoveryConfirm";
  return <>{status}<main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-slate-100 p-4">
    <section className="w-full max-w-[440px] rounded-2xl bg-white p-6 shadow-xl sm:p-8">
      <header className="mb-6 text-center"><h1 className="text-4xl font-extrabold text-blue-600">TDKON</h1>
        <p className="mt-2 text-lg font-bold text-slate-600">{title}</p></header>
      {phase === "CHECKING" ? <p className="text-center text-sm text-slate-600">인증 상태를 확인하고 있습니다.</p> :
        phase === "ERROR" ? <div className="text-center">
          <p className="text-sm font-semibold text-red-600" role="alert">{message}</p>
          <button className="mt-5 min-h-12 rounded-xl bg-blue-600 px-6 font-bold text-white"
            onClick={() => void checkInitialState()} type="button">다시 확인</button>
        </div> :
          <form className="space-y-4" onSubmit={event => submit(event)} ref={loginForm}>
            {notice && <p className="text-center text-sm font-semibold text-blue-700" role="status">{notice}</p>}
            {phase === "BOOTSTRAP_SETUP" &&
              <button className="block text-sm font-semibold text-blue-700 underline" disabled={busy}
                onClick={() => { setPassword(""); setConfirmPassword(""); setMessage(""); setNotice("");
                  setPhase("LOGIN_ID"); }} type="button">뒤로가기 · ID 변경</button>}
            {phase === "RECOVERY_ID" && <p className="text-sm text-slate-600">복구할 최고관리자 ID를 확인해 주세요.</p>}
            {phase === "CHANGE_TEMPORARY_PASSWORD" && <p className="text-sm text-slate-600">임시 비밀번호를 확인했습니다. 본인이 사용할 새 마스터 비밀번호를 설정해 주세요.</p>}
            {showId && <div><label className="block text-sm font-bold text-slate-700" htmlFor="program-login-id">ID</label>
              <span className="relative mt-2 block" data-pos-touch-input={program === "POS" && phase === "LOGIN_ID" ? "true" : undefined}>
              <input autoCapitalize="none" autoComplete="username" autoCorrect="off"
                className={`${inputStyle.replace("mt-2 ", "")} ${program === "POS" && phase === "LOGIN_ID" ? "pr-12" : ""}`}
                id="program-login-id"
                maxLength={32} onChange={event => { setLoginId(event.target.value); setPassword(""); setMessage(""); }}
                inputMode={program === "POS" && phase === "LOGIN_ID" ? "none" : undefined}
                ref={idInput}
                readOnly={phase !== "LOGIN_ID" && phase !== "RECOVERY_ID"}
                disabled={busy}
                required spellCheck={false} type="text" value={loginId} />
              {program === "POS" && phase === "LOGIN_ID" && <button aria-label="가상 키보드 열기/닫기"
                aria-pressed={activeKeyboard === "id"}
                className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 hover:text-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
                onPointerDown={event => event.preventDefault()}
                onClick={() => {
                  if (activeKeyboard === "id") setActiveKeyboard(null);
                  else openPosKeyboard("loginId", "id");
                }} type="button">
                <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                  <path strokeLinecap="round" d="M6 9h1m3 0h1m3 0h1m3 0h1M6 12h1m3 0h1m3 0h1m3 0h1M8 15h8" />
                </svg>
              </button>}
              </span></div>}
            {showPassword && (program === "POS" && phase === "LOGIN_PASSWORD" ? <div>
              <label className="block text-sm font-bold text-slate-700" htmlFor="program-master-password">마스터 비밀번호</label>
              <span className="relative mt-2 block" data-pos-touch-input="true">
                <input autoComplete="current-password" className={`${inputStyle.replace("mt-2 ", "")} pr-24`}
                  id="program-master-password" maxLength={128} minLength={10}
                  onBlur={() => setPasswordVisibility({ phase, visible: false })}
                  onChange={event => setPassword(event.target.value)} inputMode="none"
                  ref={passwordInput} required type={passwordVisible ? "text" : "password"} value={password} />
                <span className="absolute inset-y-0 right-1 flex items-center">
                  <button aria-label={passwordVisible ? "마스터 비밀번호 숨기기" : "마스터 비밀번호 보기"}
                    aria-pressed={passwordVisible}
                    className="flex h-10 w-10 items-center justify-center text-slate-500 hover:text-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
                    onPointerDown={event => event.preventDefault()}
                    onClick={() => setPasswordVisibility({ phase, visible: !passwordVisible })} type="button">
                    {passwordVisible ? <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.2A10.8 10.8 0 0112 5c5 0 8.5 4.5 9.5 7a11 11 0 01-3.2 4.4M6.2 6.2A11.4 11.4 0 002.5 12c1 2.5 4.5 7 9.5 7 1.1 0 2.1-.2 3-.5" />
                    </svg> : <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" />
                      <circle cx="12" cy="12" r="2.5" />
                    </svg>}
                  </button>
                  <button aria-label="마스터 비밀번호 가상 키보드 열기/닫기"
                    aria-pressed={activeKeyboard === "master" && keyboardTarget === "password"}
                    className="flex h-10 w-10 items-center justify-center text-slate-500 hover:text-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
                    onPointerDown={event => event.preventDefault()}
                    onClick={() => {
                      if (activeKeyboard === "master" && keyboardTarget === "password") setActiveKeyboard(null);
                      else openPosKeyboard("password", "master");
                    }} type="button">
                    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                      <rect x="3" y="5" width="18" height="14" rx="2" />
                      <path strokeLinecap="round" d="M6 9h1m3 0h1m3 0h1m3 0h1M6 12h1m3 0h1m3 0h1m3 0h1M8 15h8" />
                    </svg>
                  </button>
                </span>
              </span>
            </div> : <label className="block text-sm font-bold text-slate-700">{phase === "LOGIN_PASSWORD" || phase === "SETUP_PASSWORD" ? "마스터 비밀번호" : "새 마스터 비밀번호"}
              <input autoComplete={phase === "LOGIN_PASSWORD" ? "current-password" : "new-password"}
                className={inputStyle} disabled={phase === "SETUP_PASSWORD"} maxLength={128} minLength={10}
                onChange={event => setPassword(event.target.value)}
                onFocus={() => { if (program === "POS") openPosKeyboard("password", "master"); }}
                onPointerDown={() => { if (program === "POS") openPosKeyboard("password", "master"); }}
                data-pos-touch-input={program === "POS" ? "true" : undefined}
                inputMode={program === "POS" ? "none" : undefined}
                ref={phase === "LOGIN_PASSWORD" ? passwordInput : undefined}
                required={phase !== "SETUP_PASSWORD"}
                type="password" value={password} /></label>)}
            {phase === "SETUP_PIN" && pinReset && <label className="block text-sm font-bold text-slate-700">마스터 비밀번호
              <input autoComplete="current-password" className={inputStyle} maxLength={128} minLength={10}
                onChange={event => setPassword(event.target.value)}
                onFocus={() => openPosKeyboard("password", "master")} onPointerDown={() => openPosKeyboard("password", "master")}
                data-pos-touch-input={program === "POS" ? "true" : undefined} inputMode={program === "POS" ? "none" : undefined}
                required type="password" value={password} /></label>}
            {(phase === "BOOTSTRAP_SETUP" || phase === "CHANGE_TEMPORARY_PASSWORD") &&
              <label className="block text-sm font-bold text-slate-700">마스터 비밀번호 확인
                <input autoComplete="new-password" className={inputStyle} maxLength={128} minLength={10}
                  onChange={event => setConfirmPassword(event.target.value)}
                  onFocus={() => openPosKeyboard("confirmPassword", "master")}
                  onPointerDown={() => openPosKeyboard("confirmPassword", "master")}
                  data-pos-touch-input={program === "POS" ? "true" : undefined} inputMode={program === "POS" ? "none" : undefined}
                  required type="password" value={confirmPassword} /></label>}
            {phase === "SETUP_PIN" && <>
              <label className="block text-sm font-bold text-slate-700">새 6자리 PIN
                <input autoComplete="new-password" className={inputStyle} maxLength={6}
                  onChange={event => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  onFocus={() => { if (program === "POS") openPosKeyboard("pin", "pin"); }}
                  onPointerDown={() => { if (program === "POS") openPosKeyboard("pin", "pin"); }}
                  data-pos-touch-input={program === "POS" ? "true" : undefined}
                  inputMode={program === "POS" ? "none" : "numeric"}
                  ref={pinInput} required type="password" value={pin} /></label>
              <label className="block text-sm font-bold text-slate-700">PIN 확인
                <input autoComplete="new-password" className={inputStyle} maxLength={6}
                  onChange={event => setPinConfirm(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  onFocus={() => { if (program === "POS") openPosKeyboard("pinConfirm", "pin"); }}
                  onPointerDown={() => { if (program === "POS") openPosKeyboard("pinConfirm", "pin"); }}
                  data-pos-touch-input={program === "POS" ? "true" : undefined}
                  inputMode={program === "POS" ? "none" : "numeric"}
                  required type="password" value={pinConfirm} /></label>
            </>}
            <p aria-live="polite" className="min-h-6 text-center text-sm font-semibold text-red-600"
              role={message ? "alert" : undefined}>{message}</p>
            <button className="min-h-14 w-full rounded-xl bg-blue-600 font-extrabold text-white disabled:opacity-50"
              disabled={disabled || loginKeyboardOpen}
              type="submit">{buttonText}</button>
            {phase === "LOGIN_ID" && (program === "ADM" || program === "KDS" || program === "POS" || program === "HOS") ?
              <p className="text-center text-xs text-slate-500">ID를 입력한 후 다음 버튼을 눌러주세요.</p> :
              phase === "LOGIN_PASSWORD" && (program === "ADM" || program === "POS") ?
                <p className="text-center text-xs text-slate-500">마스터 비밀번호를 입력해 주세요.</p> :
              phase === "LOGIN_PASSWORD" && program === "KDS" ?
                <p className="text-center text-xs text-slate-500">마스터 비밀번호를 입력해 주세요.</p> :
              phase === "SETUP_PIN" && program === "KDS" && !pinReset ?
                <p className="text-center text-xs text-slate-500">등록 후에는 개인 6자리 PIN으로 로그인합니다.</p> :
                phase === "SETUP_PIN" && program === "ADM" && !pinReset ?
                  <p className="text-center text-xs text-slate-500">등록 후에는 개인 6자리 PIN으로 로그인합니다.</p> :
                phase !== "SETUP_PIN" &&
                  <p className="text-center text-xs text-slate-500">인증 후 개인 6자리 PIN으로 로그인합니다.</p>}
          </form>}
    </section>
    {program === "POS" && activeKeyboard && keyboardTarget !== "recoveryPassword" && keyboardTarget !== "recoveryConfirm" &&
      <PosTouchKeyboard mode={activeKeyboard}
        onText={text => { keyboardText(text); setMessage(""); setRecoveryError(""); }}
        onBackspace={() => { keyboardBackspace(); setMessage(""); setRecoveryError(""); }}
        onClear={() => { keyboardClear(); setMessage(""); setRecoveryError(""); }}
        onConfirm={() => loginForm.current?.requestSubmit()}
        onClose={() => setActiveKeyboard(null)} actionLabel={buttonText} actionDisabled={busy} />}
    <dialog aria-labelledby="master-recovery-title"
      className="m-auto w-[min(420px,calc(100vw-2rem))] rounded-2xl bg-white p-6 text-slate-800 shadow-xl backdrop:bg-slate-900/60"
      onCancel={event => { if (busy) event.preventDefault(); else setRecoveryOpen(false); }}
      ref={recoveryDialog}>
      <form className="space-y-4" onSubmit={event => submitRecovery(event)} ref={recoveryForm}>
        <h2 className="text-center text-xl font-bold" id="master-recovery-title">{initialPasswordRegistration ?
          "마스터 비밀번호 등록" : masterRecoveryActionLabel(recoveryPasswordConfigured)}</h2>
        <label className="block text-sm font-bold">마스터 비밀번호
          <input autoComplete="new-password" className={inputStyle} maxLength={128} minLength={10}
            onChange={event => setRecoveryPassword(event.target.value)}
            onFocus={() => openPosKeyboard("recoveryPassword", "master")}
            onPointerDown={() => openPosKeyboard("recoveryPassword", "master")}
            data-pos-touch-input={program === "POS" ? "true" : undefined}
            inputMode={program === "POS" ? "none" : undefined} required type="password"
            value={recoveryPassword} /></label>
        <label className="block text-sm font-bold">마스터 비밀번호 확인
          <input autoComplete="new-password" className={inputStyle} maxLength={128} minLength={10}
            onChange={event => setRecoveryConfirm(event.target.value)}
            onFocus={() => openPosKeyboard("recoveryConfirm", "master")}
            onPointerDown={() => openPosKeyboard("recoveryConfirm", "master")}
            data-pos-touch-input={program === "POS" ? "true" : undefined}
            inputMode={program === "POS" ? "none" : undefined} required type="password"
            value={recoveryConfirm} /></label>
        <p className="text-xs text-slate-500">영문·숫자·특수문자를 포함해 10자 이상 입력해 주세요.</p>
        <p aria-live="polite" className="min-h-5 text-center text-sm text-red-600" role={recoveryError ? "alert" : undefined}>
          {recoveryError}</p>
        <div className="flex gap-3">
          <button className="min-h-12 flex-1 rounded-xl bg-slate-200 font-bold" disabled={busy}
            onClick={() => setRecoveryOpen(false)} type="button">취소</button>
          <button className="min-h-12 flex-1 rounded-xl bg-blue-600 font-bold text-white disabled:opacity-50"
            disabled={busy || !meetsMasterPasswordPolicy(recoveryPassword) || recoveryPassword !== recoveryConfirm}
            type="submit">등록</button>
        </div>
      </form>
      {program === "POS" && activeKeyboard === "master" &&
        (keyboardTarget === "recoveryPassword" || keyboardTarget === "recoveryConfirm") &&
        <div className="mt-3">
          <PosTouchKeyboard mode="master"
            onText={text => { keyboardText(text); setRecoveryError(""); }}
            onBackspace={() => { keyboardBackspace(); setRecoveryError(""); }}
            onClear={() => { keyboardClear(); setRecoveryError(""); }}
            onConfirm={() => recoveryForm.current?.requestSubmit()}
            onClose={() => setActiveKeyboard(null)} />
        </div>}
    </dialog>
  </main></>;
}
