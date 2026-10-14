"use client";

import Image from "next/image";
import type { PrintDocument } from "@/lib/print-document";

export default function PrintDocumentPreview({ document, logoDataUrl }: { document: PrintDocument; logoDataUrl: string | null }) {
  return <div className="w-[80mm] max-w-full bg-white px-[4mm] py-3 text-black" style={{ fontFamily: '"Malgun Gothic", sans-serif' }}>
    {document.commands.map((command, index) => {
      if (command.type === "logo") return logoDataUrl
        ? <div className="relative mx-auto h-[70px] w-full" key={index}><Image alt="영수증 로고" className="object-contain" fill sizes="72mm" src={logoDataUrl} unoptimized /></div>
        : null;
      if (command.type === "text") return <div className="break-words" key={index} style={{ textAlign: command.align, fontSize: command.size * 0.53, fontWeight: command.bold ? 700 : 500, lineHeight: 1.35 }}>{command.value}</div>;
      if (command.type === "row") {
        const style = { fontSize: command.size * 0.53, fontWeight: command.bold ? 700 : 500, lineHeight: 1.35 };
        return command.cells
          ? <div className="grid items-start" key={index} style={{ ...style, gridTemplateColumns: command.cells.map(cell => `${cell.width}%`).join(" ") }}>{command.cells.map((cell, cellIndex) => <span className="min-w-0 break-words" key={cellIndex} style={{ textAlign: cell.align }}>{cell.value}</span>)}</div>
          : <div className="flex items-start justify-between gap-2" key={index} style={style}><span className="min-w-0 break-words">{command.left}</span><span className="shrink-0 text-right">{command.right}</span></div>;
      }
      if (command.type === "line") return <div className="border-t border-dashed border-black" key={index} />;
      if (command.type === "feed") return <div aria-hidden="true" key={index} style={{ height: command.lines * 15 }} />;
      if (command.type === "barcode") return <div className="mx-auto mt-2 w-36 text-center" key={index}><div aria-hidden="true" className="h-12 w-full bg-[repeating-linear-gradient(90deg,#000_0px,#000_2px,#fff_2px,#fff_4px,#000_4px,#000_5px,#fff_5px,#fff_8px)]" />{command.showHri !== false && <span className="text-[10px] tracking-widest">{command.value}</span>}</div>;
      return null; // The paper cutter has no visible preview element.
    })}
  </div>;
}
