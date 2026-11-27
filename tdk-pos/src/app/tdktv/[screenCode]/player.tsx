"use client";

import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { parseJsonResponse } from "@/lib/api-response";
import { useTvQrAuthCode } from "@/lib/use-tv-qr-auth-code";
import { shouldDisplayTvQrAuthCode } from "@/lib/tdktv-qr-auth-code-policy";
import { getTvEventAnchorStyle, getTvEventTextStyle } from "@/lib/tdktv-event-rendering";

type EventAnimation = "NONE" | "FADE" | "PULSE" | "SLIDE" | "GLOW";
type TvEvent = { eventId: number; eventName: string; message: string; positionX: number; positionY: number; widthPercent: number;
  fontSize: number; fontWeight: number; textColor: string; textAlign: "LEFT" | "CENTER" | "RIGHT"; lineHeight: number;
  backgroundMode: "NONE" | "SOLID" | "TRANSLUCENT"; backgroundColor: string; backgroundOpacity: number;
  borderEnabled: boolean; borderColor: string; borderWidth: number; borderRadius: number; animation: EventAnimation };
type ImageItem = { id: number; durationSeconds: number; url: string; version: string; events: TvEvent[] };
type Timeline = { groupName: string; intervalSeconds: number; cycleIndex: number; nextTransitionAt: number; serverNow: number; transitionEffect: "NONE" | "FADE" | "SLIDE" | "ZOOM" };
type BusinessNotice = { targetCode: string | null; message: string | null; startedAt: string | null } | null;
type Playlist = { code: string; name: string; isActive: boolean; playbackEnabled: boolean; defaultDurationSeconds: number;
  loopEnabled: boolean; fitMode: "CONTAIN" | "COVER"; transitionEffect: "NONE" | "FADE" | "SLIDE" | "ZOOM";
  syncGroup: string | null; timeline: Timeline | null; notice: BusinessNotice; images: ImageItem[]; version: string; imageVersion: string; playbackVersion: string };
type Transition = { from: number; to: number; effect: Playlist["transitionEffect"]; groupCycle?: number };

function ImageLayer({ item, fitMode, className = "", style }: { item: ImageItem; fitMode: "CONTAIN" | "COVER"; className?: string; style?: CSSProperties }) {
  return <div className={`absolute inset-0 overflow-hidden ${className}`} style={style}>
    <Image unoptimized fill key={item.version} src={item.url} alt="" draggable={false}
      className="absolute inset-0" style={{ objectFit: fitMode === "COVER" ? "cover" : "contain" }} sizes="100vw" />
    {item.events.map(event => <div key={event.eventId} className={`tdktv-event tdktv-event-${event.animation.toLowerCase()}`}
      style={{ ...getTvEventAnchorStyle(event), "--tdktv-event-glow": event.borderEnabled ? event.borderColor : event.textColor } as CSSProperties}>
        <span className="tdktv-event-content" style={getTvEventTextStyle(event)}>{event.message}</span>
      </div>)}
  </div>;
}

export default function TvPlayer({ screenCode }: { screenCode: string }) {
  const isPrimaryDisplay = shouldDisplayTvQrAuthCode(screenCode, false);
  const qrAuthCode = useTvQrAuthCode("/api/tdktv/qr-auth-code", isPrimaryDisplay);
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [index, setIndex] = useState(0);
  const [transition, setTransition] = useState<Transition | null>(null);
  const [message, setMessage] = useState("재생 설정을 확인하는 중입니다.");
  const versionRef = useRef("");
  const imageVersionRef = useRef("");
  const serverOffset = useRef(0);
  useEffect(() => {
    let live = true;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/tdktv/${encodeURIComponent(screenCode)}`, { cache: "no-store" });
        if (!response.ok) throw Error("관리자 인증 또는 TV 설정을 확인할 수 없습니다.");
        const next = await parseJsonResponse<Playlist>(response, response.url, "TV playlist", "GET");
        if (!live) return;
        serverOffset.current = next.timeline ? next.timeline.serverNow - Date.now() : 0;
        if (next.imageVersion !== imageVersionRef.current && !next.notice) await Promise.all(next.images.map(item => new Promise<void>(resolve => {
          const image = new window.Image(); image.onload = () => resolve(); image.onerror = () => resolve(); image.src = item.url;
        })));
        if (!live) return;
        const previous = playlist?.images[index];
        const nextIndex = next.timeline && next.images.length ? next.timeline.cycleIndex % next.images.length : previous ? Math.max(0, next.images.findIndex(item => item.version === previous.version)) : 0;
        const changed = next.version !== versionRef.current;
        const imageChanged = next.imageVersion !== imageVersionRef.current;
        const timelineChanged = next.timeline?.cycleIndex !== playlist?.timeline?.cycleIndex || next.timeline?.nextTransitionAt !== playlist?.timeline?.nextTransitionAt;
        versionRef.current = next.version;
        if (imageChanged && !next.notice) imageVersionRef.current = next.imageVersion;
        if (next.notice) setTransition(null);
        if (changed || timelineChanged) setPlaylist(next);
        if ((imageChanged || timelineChanged) && !transition) setIndex(nextIndex);
        setMessage("");
      } catch (error) { if (live && !playlist) setMessage(error instanceof Error ? error.message : "재생 정보를 불러오지 못했습니다."); }
    };
    void refresh(); const timer = window.setInterval(() => void refresh(), 10_000);
    return () => { live = false; window.clearInterval(timer); };
  }, [screenCode, playlist, index, transition]);

  const images = useMemo(() => playlist?.images ?? [], [playlist?.images]);
  const current = images[index];
  const noticeActive = Boolean(playlist?.notice);
  const playbackConfig = useMemo(() => playlist ? {
    isActive: playlist.isActive, playbackEnabled: playlist.playbackEnabled, loopEnabled: playlist.loopEnabled,
    defaultDurationSeconds: playlist.defaultDurationSeconds, transitionEffect: playlist.transitionEffect,
    images: playlist.images.map(item => ({ version: item.version, durationSeconds: item.durationSeconds })), timeline: playlist.timeline,
  // playbackVersion hashes every timer-driving field, while event-only playlist changes must not reset the image timer.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  } : null, [playlist?.playbackVersion, playlist?.timeline?.groupName, playlist?.timeline?.intervalSeconds,
    playlist?.timeline?.cycleIndex, playlist?.timeline?.nextTransitionAt, playlist?.timeline?.transitionEffect]);
  useEffect(() => {
    if (!playbackConfig || noticeActive) return;
    if (!playbackConfig.isActive || !playbackConfig.playbackEnabled || playbackConfig.images.length < 2 || transition) return;
    if (playbackConfig.timeline) {
      const { cycleIndex, nextTransitionAt, transitionEffect } = playbackConfig.timeline;
      const timeout = window.setTimeout(() => {
        const to = (cycleIndex + 1) % playbackConfig.images.length;
        if (transitionEffect === "NONE") {
          setIndex(to);
          setPlaylist(current => current?.timeline ? { ...current, timeline: { ...current.timeline, cycleIndex: cycleIndex + 1,
            nextTransitionAt: current.timeline.nextTransitionAt + current.timeline.intervalSeconds * 1000 } } : current);
        }
        else setTransition({ from: index, to, effect: transitionEffect, groupCycle: cycleIndex + 1 });
      }, Math.max(0, nextTransitionAt - (Date.now() + serverOffset.current) + (transitionEffect === "NONE" ? 800 : 0)));
      return () => window.clearTimeout(timeout);
    }
    const timeout = window.setTimeout(() => {
      const to = index + 1 < playbackConfig.images.length ? index + 1 : playbackConfig.loopEnabled ? 0 : index;
      if (to === index) return;
      if (playbackConfig.transitionEffect === "NONE") setIndex(to);
      else setTransition({ from: index, to, effect: playbackConfig.transitionEffect });
    }, Math.max(1, playbackConfig.images[index]?.durationSeconds ?? playbackConfig.defaultDurationSeconds) * 1000);
    return () => window.clearTimeout(timeout);
  }, [playbackConfig, index, transition, noticeActive]);

  const timelineIntervalMs = playlist?.timeline?.intervalSeconds ?? null;
  useEffect(() => {
    if (!transition || noticeActive) return;
    const timeout = window.setTimeout(() => {
      setIndex(transition.to);
      if (timelineIntervalMs !== null && transition.groupCycle !== undefined) setPlaylist(current => current?.timeline ? { ...current, timeline: {
        ...current.timeline, cycleIndex: transition.groupCycle!, nextTransitionAt: current.timeline.nextTransitionAt + timelineIntervalMs * 1000,
      } } : current);
      setTransition(null);
    }, 800);
    return () => window.clearTimeout(timeout);
  }, [transition, timelineIntervalMs, noticeActive]);

  const status = !playlist ? message : !playlist.isActive ? "이 TV는 사용 중지 상태입니다." : !playlist.playbackEnabled ? "TV 재생이 중지되어 있습니다." : "재생할 이미지가 없습니다.";
  const noticeTarget = playlist?.notice?.targetCode === screenCode;
  return <main className="fixed inset-0 overflow-hidden" style={{ backgroundColor: noticeActive ? noticeTarget ? "#145B46" : "#E8E8E8" : "#000000" }} aria-label={`${screenCode} 디지털 사이니지`}>
    {noticeActive && noticeTarget && <div className="absolute inset-0 grid place-items-center p-[8%] text-center text-white"><p className="max-h-full w-full overflow-hidden whitespace-pre-wrap break-words text-[clamp(2rem,6vw,5.5rem)] font-bold leading-tight">{playlist?.notice?.message}</p></div>}
    {!noticeActive && playlist && playlist.isActive && playlist.playbackEnabled && current && <>
      <ImageLayer item={current} fitMode={playlist.fitMode} className={transition?.effect === "SLIDE" ? "tdktv-slide-out" : ""} />
      {transition && <ImageLayer item={images[transition.to] ?? current} fitMode={playlist.fitMode} className={`tdktv-transition tdktv-transition-${transition.effect.toLowerCase()}`} />}
    </>}
    {!noticeActive && status && !current && <div className="absolute inset-0 grid place-items-center bg-neutral-950 text-center text-white"><p>{status}</p></div>}
    {shouldDisplayTvQrAuthCode(screenCode, noticeActive) && <div aria-label={`인증번호 ${qrAuthCode ?? "--"}`} className="pointer-events-none absolute inset-0 z-50 grid place-items-center" role="status">
      <span className="rounded-2xl bg-black/65 px-[0.7em] py-[0.25em] text-[clamp(5rem,24vw,24rem)] font-black leading-none tracking-[0.08em] tabular-nums text-white drop-shadow-[0_4px_16px_rgba(0,0,0,0.9)]">{qrAuthCode ?? "--"}</span>
    </div>}
    <style jsx global>{`
      @keyframes tdktv-fade { from { opacity: 0; } to { opacity: 1; } }
      @keyframes tdktv-slide { from { transform: translateX(100%); } to { transform: translateX(0); } }
      @keyframes tdktv-zoom { from { opacity: 0; transform: scale(1.04); } to { opacity: 1; transform: scale(1); } }
      @keyframes tdktv-slide-out { to { transform: translateX(-100%); } }
      @keyframes tdktv-event-fade { 0%, 100% { opacity: .72; } 50% { opacity: 1; } }
      @keyframes tdktv-event-pulse { 0%, 100% { transform: translate(-50%, -50%) scale(1); } 50% { transform: translate(-50%, -50%) scale(1.045); } }
      @keyframes tdktv-event-slide { 0%, 100% { transform: translate(-50%, -50%); } 50% { transform: translate(-50%, calc(-50% - 5px)); } }
      @keyframes tdktv-event-glow { 0%, 100% { filter: drop-shadow(0 0 2px var(--tdktv-event-glow)); } 50% { filter: drop-shadow(0 0 12px var(--tdktv-event-glow)); } }
      .tdktv-transition { animation-duration: 800ms; animation-timing-function: ease-in-out; animation-fill-mode: both; }
      .tdktv-transition-fade { animation-name: tdktv-fade; }
      .tdktv-transition-slide { animation-name: tdktv-slide; }
      .tdktv-transition-zoom { animation-name: tdktv-zoom; }
      .tdktv-slide-out { animation: tdktv-slide-out 800ms ease-in-out both; }
      .tdktv-event { position: absolute; }
      .tdktv-event-fade { animation: tdktv-event-fade 2s ease-in-out infinite; }
      .tdktv-event-pulse { animation: tdktv-event-pulse 2s ease-in-out infinite; }
      .tdktv-event-slide { animation: tdktv-event-slide 2s ease-in-out infinite; }
      .tdktv-event-glow { animation: tdktv-event-glow 2s ease-in-out infinite; }
      @media (prefers-reduced-motion: reduce) { .tdktv-event, .tdktv-transition, .tdktv-slide-out { animation: none !important; } }
    `}</style>
  </main>;
}
