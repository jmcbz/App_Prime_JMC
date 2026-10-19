/** Logo PRIsME Prime — Tour des Titans BZ. Hexagone néon + T + étoile. */
export default function LogoTitan({ size = 40, className = '' }: { size?: number; className?: string }) {
  const id = 'lt';
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" className={className} aria-label="PRIsME Prime" role="img">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0f172a" />
          <stop offset="1" stopColor="#1e1b4b" />
        </linearGradient>
        <linearGradient id={`${id}-t`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#22d3ee" />
          <stop offset="1" stopColor="#6366f1" />
        </linearGradient>
        <filter id={`${id}-glow`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect x="40" y="40" width="432" height="432" rx="116" fill={`url(#${id}-bg)`} />
      <rect x="46" y="46" width="420" height="420" rx="110" fill="none" stroke={`url(#${id}-t)`} strokeOpacity="0.5" strokeWidth="4" />
      <path d="M256 104 L388 180 L388 332 L256 408 L124 332 L124 180 Z" fill="none" stroke={`url(#${id}-t)`} strokeWidth="10" strokeLinejoin="round" filter={`url(#${id}-glow)`} opacity="0.9" />
      <g filter={`url(#${id}-glow)`}>
        <rect x="160" y="176" width="192" height="44" rx="14" fill={`url(#${id}-t)`} />
        <rect x="234" y="176" width="44" height="180" rx="14" fill={`url(#${id}-t)`} />
      </g>
      <path d="M256 92 l9 18 20 3 -14.5 14 3.5 20 -18 -9.5 -18 9.5 3.5 -20 -14.5 -14 20 -3 Z" fill="#22d3ee" filter={`url(#${id}-glow)`} />
    </svg>
  );
}
