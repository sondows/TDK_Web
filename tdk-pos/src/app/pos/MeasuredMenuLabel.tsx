"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";

type LabelPart = "name" | "option" | "tail";

function graphemes(value: string) {
  if (typeof Intl.Segmenter !== "undefined") {
    return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value), (part) => part.segment);
  }
  return Array.from(value);
}

export default function MeasuredMenuLabel({
  name,
  optionLabel,
  onOptionClick,
  optionClassName = "ml-1 text-[10px] font-normal text-slate-500",
  tail,
  tailClassName = "ml-1 font-semibold text-blue-700",
  prefix,
  prefixClassName = "mr-1 text-slate-400",
  className = "min-w-0 overflow-hidden whitespace-nowrap font-medium",
  title,
}: {
  name: string;
  optionLabel?: string;
  onOptionClick?: () => void;
  optionClassName?: string;
  tail?: string;
  tailClassName?: string;
  prefix?: string;
  prefixClassName?: string;
  className?: string;
  title?: string;
}) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const nameRef = useRef<HTMLSpanElement>(null);
  const optionRef = useRef<HTMLElement>(null);
  const tailRef = useRef<HTMLElement>(null);
  const prefixRef = useRef<HTMLSpanElement>(null);
  const [visibleCount, setVisibleCount] = useState<number | null>(null);
  const [observedWidth, setObservedWidth] = useState(0);
  const optionText = optionLabel ? `(${optionLabel})` : "";
  const segments = useMemo<Array<{ part: LabelPart; chars: string[] }>>(() => [
    { part: "name", chars: graphemes(name) },
    { part: "option", chars: graphemes(optionText) },
    { part: "tail", chars: graphemes(tail ?? "") },
  ], [name, optionText, tail]);
  const allChars = useMemo(() => segments.flatMap((segment) => segment.chars), [segments]);
  const shownCount = visibleCount ?? allChars.length;
  let remaining = shownCount;
  const shown = new Map<LabelPart, string>();
  for (const segment of segments) {
    const count = Math.min(remaining, segment.chars.length);
    shown.set(segment.part, segment.chars.slice(0, count).join(""));
    remaining -= count;
  }
  const clipped = shownCount < allChars.length;

  useLayoutEffect(() => {
    const root = rootRef.current;
    const nameNode = nameRef.current;
    if (!root || !nameNode) return;

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return;
    const measure = (text: string, node: HTMLElement | null) => {
      if (!text || !node) return 0;
      const style = window.getComputedStyle(node);
      context.font = style.font;
      const letterSpacing = Number.parseFloat(style.letterSpacing) || 0;
      return context.measureText(text).width + Math.max(0, graphemes(text).length - 1) * letterSpacing;
    };
    const margin = (node: HTMLElement | null) => node ? Number.parseFloat(window.getComputedStyle(node).marginLeft) || 0 : 0;
    const fullCount = allChars.length;
    const prefixWidth = prefixRef.current?.getBoundingClientRect().width ?? 0;
    const prefixMargin = prefixRef.current ? margin(prefixRef.current) + (Number.parseFloat(window.getComputedStyle(prefixRef.current).marginRight) || 0) : 0;
    const available = root.clientWidth - prefixWidth - prefixMargin;
    if (available <= 0) {
      setVisibleCount(0);
      return;
    }

    const fits = (count: number, withSuffix: boolean) => {
      let left = count;
      let width = 0;
      for (const segment of segments) {
        const partCount = Math.min(left, segment.chars.length);
        const text = segment.chars.slice(0, partCount).join("");
        const node = segment.part === "name" ? nameNode : segment.part === "option" ? optionRef.current : tailRef.current;
        width += measure(text, node);
        if (text) width += margin(node);
        left -= partCount;
      }
      if (withSuffix) width += measure("..", nameNode);
      return width <= available;
    };

    if (fits(fullCount, false)) {
      setVisibleCount(fullCount);
      return;
    }
    let low = 0;
    let high = fullCount;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (fits(middle, true)) low = middle;
      else high = middle - 1;
    }
    setVisibleCount(low);
    setObservedWidth(root.clientWidth);
  }, [name, optionText, tail, className, optionClassName, tailClassName, prefix, prefixClassName, observedWidth, segments, allChars.length]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setObservedWidth(root.clientWidth));
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const optionElement = shown.get("option");
  const tailElement = shown.get("tail");
  return (
    <span className={className} ref={rootRef} title={title ?? `${name}${optionText ? ` ${optionText}` : ""}`}>
      {prefix && <span aria-hidden="true" className={prefixClassName} ref={prefixRef}>{prefix}</span>}
      <span ref={nameRef}>{shown.get("name")}</span>
      {optionElement && (onOptionClick
        ? <button className={optionClassName} onClick={onOptionClick} type="button">{optionElement}</button>
        : <small className={optionClassName}>{optionElement}</small>)}
      {tailElement && <small className={tailClassName}>{tailElement}</small>}
      {clipped && <span aria-hidden="true">..</span>}
      {optionText && <small aria-hidden="true" className={optionClassName} ref={optionRef} style={{ left: "-10000px", position: "absolute", visibility: "hidden" }}>{optionText}</small>}
      {tail && <small aria-hidden="true" className={tailClassName} ref={tailRef} style={{ left: "-10000px", position: "absolute", visibility: "hidden" }}>{tail}</small>}
    </span>
  );
}
