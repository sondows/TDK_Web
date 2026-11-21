export default function QrMenuAddIcon({ className = "h-[25px] w-[25px] overflow-visible", color = "#1769D2" }: {
  className?: string;
  color?: string;
}) {
  return <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 256 256">
    <g stroke="#FFFFFF" strokeLinecap="round" strokeLinejoin="round" strokeWidth="44">
      <path d="M34 58h22c8 0 14 5 16 13l20 92c2 8 9 14 17 14h79c8 0 15-6 17-14l17-71" />
      <path d="M145 78v58M116 107h58" />
      <circle cx="116" cy="207" r="14" />
      <circle cx="184" cy="207" r="14" />
    </g>
    <g stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth="16">
      <path d="M34 58h22c8 0 14 5 16 13l20 92c2 8 9 14 17 14h79c8 0 15-6 17-14l17-71" />
      <path d="M145 78v58M116 107h58" />
      <circle cx="116" cy="207" r="14" />
      <circle cx="184" cy="207" r="14" />
    </g>
  </svg>;
}
