export default function QrDoubleDivider({ fullBleed = false }: { fullBleed?: boolean }) {
  return <div aria-hidden="true" className={`relative h-4 bg-slate-50 ${fullBleed ? "left-1/2 z-[2] w-screen -translate-x-1/2" : "w-full"}`}>
    <span className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-px bg-[#D0D8E2]" style={{ boxShadow: "0 3px 3px rgba(0, 0, 0, 0.2)" }} />
    <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[#E5EAF0]" />
  </div>;
}
