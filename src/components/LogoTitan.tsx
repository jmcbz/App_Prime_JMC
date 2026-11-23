/** Supplied PRIME artwork: preserve the complete image and its background. */
export default function LogoTitan({ size = 160, className = '' }: { size?: number; className?: string }) {
  return (
    <img src="/prime-logo.png" alt="PRIME — LA TOUR PRIME" width={size} height={size}
      className={`shrink-0 object-contain ${className}`} />
  );
}
