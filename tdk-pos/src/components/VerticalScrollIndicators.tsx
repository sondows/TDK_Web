export default function VerticalScrollIndicators({ above, below }: { above: boolean; below: boolean }) {
  return <>
    {above && <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-10 text-center text-sm font-bold leading-none tracking-widest text-slate-500">•••</span>}
    {below && <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 z-10 text-center text-sm font-bold leading-none tracking-widest text-slate-500">•••</span>}
  </>;
}
