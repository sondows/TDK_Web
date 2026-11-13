"use client";

import { useEffect, useRef, useState, type TouchEvent } from "react";
import Image from "next/image";
import { QR_TITLE_AUTOPLAY_MS } from "@/lib/qr-title-model";
import type { QrTitleSlide } from "@/lib/qr-title-model";

export type { QrTitleSlide } from "@/lib/qr-title-model";

export default function QrTitleCarousel({ photos, photoHeightPx, viewportHeightPx, fixedHero = false }: { photos: QrTitleSlide[]; photoHeightPx?: number; viewportHeightPx?: number; fixedHero?: boolean }) {
  const [trackIndex, setTrackIndex] = useState(photos.length > 1 ? 1 : 0);
  const [visible, setVisible] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [transitioning, setTransitioning] = useState(true);
  const start = useRef<{ x: number; y: number } | null>(null);
  const root = useRef<HTMLElement>(null);
  const count = photos.length;
  const activeIndex = count ? (trackIndex - 1 + count) % count : 0;
  const slides = count > 1 ? [photos[count - 1], ...photos, photos[0]] : photos;

  useEffect(() => {
    const node = fixedHero ? document.querySelector<HTMLElement>("[data-qr-content-start]") : root.current;
    if (!node || !count) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.05 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [count, fixedHero]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (count < 2 || !visible || reduceMotion) return;
    const timer = window.setTimeout(() => { setTransitioning(true); setTrackIndex(index => index + 1); }, QR_TITLE_AUTOPLAY_MS);
    return () => window.clearTimeout(timer);
  }, [count, visible, reduceMotion, trackIndex]);

  if (!count) return null;

  const go = (direction: number) => {
    if (count < 2) return;
    if (reduceMotion) {
      setTransitioning(false);
      setTrackIndex(index => ((index - 1 + direction + count) % count) + 1);
    } else {
      setTransitioning(true);
      setTrackIndex(index => index + direction);
    }
  };
  const onTouchStart = (event: TouchEvent<HTMLElement>) => {
    const touch = event.touches[0];
    if (touch) start.current = { x: touch.clientX, y: touch.clientY };
  };
  const onTouchEnd = (event: TouchEvent<HTMLElement>) => {
    const initial = start.current;
    const touch = event.changedTouches[0];
    start.current = null;
    if (!initial || !touch) return;
    const dx = touch.clientX - initial.x;
    const dy = touch.clientY - initial.y;
    if (Math.abs(dx) > 36 && Math.abs(dx) > Math.abs(dy) * 1.2) go(dx < 0 ? 1 : -1);
  };
  const onTransitionEnd = () => {
    if (count < 2) return;
    if (trackIndex === count + 1 || trackIndex === 0) {
      setTransitioning(false);
      setTrackIndex(trackIndex === count + 1 ? 1 : count);
    }
  };

  return <section aria-label="매장 사진" className={`${fixedHero ? "fixed inset-x-0 top-0 z-0 w-full aspect-[4/3]" : "relative w-full aspect-[4/3]"} touch-pan-y overflow-hidden bg-slate-100`} data-qr-fixed-hero={fixedHero ? "true" : undefined} data-qr-title-carousel onTouchEnd={onTouchEnd} onTouchStart={onTouchStart} ref={root} style={viewportHeightPx !== undefined ? { height: viewportHeightPx } : photoHeightPx !== undefined ? { height: photoHeightPx } : undefined}>
    <div className="relative w-full overflow-hidden" style={photoHeightPx === undefined ? { height: "100%" } : { height: photoHeightPx }}>
      <div className={`flex h-full w-full ${transitioning && !reduceMotion ? "transition-transform duration-500 ease-out" : ""}`} onTransitionEnd={onTransitionEnd} style={{ transform: `translateX(-${trackIndex * 100}%)` }}>
        {slides.map((photo, slideIndex) => <div aria-hidden={slideIndex !== trackIndex} className="relative h-full w-full shrink-0" key={`${photo.id}-${slideIndex}`}>
          <Image alt={photo.alt} className="object-cover" fill priority={slideIndex === (count > 1 ? 1 : 0)} sizes="100vw" src={photo.imageUrl} unoptimized />
        </div>)}
      </div>
    </div>
    {count > 1 && <div aria-label="사진 선택" className="absolute inset-x-0 bottom-3 flex justify-center gap-2">{photos.map((photo, dotIndex) => <button aria-current={activeIndex === dotIndex ? "true" : undefined} aria-label={`${dotIndex + 1}번째 사진`} className={`h-2.5 rounded-full shadow-sm ${activeIndex === dotIndex ? "w-5 bg-white" : "w-2.5 bg-white/60"}`} key={photo.id} onClick={() => { setTransitioning(!reduceMotion); setTrackIndex(dotIndex + 1); }} type="button" />)}</div>}
  </section>;
}
