import { cn } from "@/lib/utils";

// Romeins embleem: een rondboog met sluitsteen om de S, op metselwerk in
// halfsteensverband. Sluit aan op de arcade in de footer.
// Alles in een viewBox van 40×40; kleuren via currentColor zodat beide thema's werken.

export function LogoMark({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-md border border-line-strong bg-ink-deeper shadow-card",
        className
      )}
    >
      <svg
        viewBox="0 0 40 40"
        className="absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        <defs>
          {/* Metselwerk: twee rijen, elke rij een halve steen verspringend */}
          <pattern
            id="scriptor-brick"
            className="text-ink-mute"
            width="12"
            height="12"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M0 6H12M0 12H12M6 0V6M0 6V12M12 6V12"
              fill="none"
              stroke="currentColor"
              strokeWidth="0.5"
            />
          </pattern>
          <radialGradient id="scriptor-brick-fade">
            <stop offset="0.4" stopColor="black" />
            <stop offset="1" stopColor="white" />
          </radialGradient>
          <mask id="scriptor-brick-mask">
            <rect width="40" height="40" fill="url(#scriptor-brick-fade)" />
          </mask>
        </defs>

        {/* Metselwerk, vervaagt naar het midden toe */}
        <rect
          width="40"
          height="40"
          fill="url(#scriptor-brick)"
          mask="url(#scriptor-brick-mask)"
          opacity="0.55"
        />

        {/* Rondboog op pilasters, met sluitsteen en plint */}
        <g className="text-seal">
          <path
            d="M9 32.2V22.5a11 11 0 0 1 22 0v9.7"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.1"
          />
          <path
            d="M6.5 32.9H33.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          <path d="M17.7 9.8H22.3L21.6 14.9H18.4Z" fill="currentColor" />
        </g>
      </svg>

      <span className="relative translate-y-[2px] font-display text-[15px] font-medium leading-none text-ink-strong">
        S
      </span>
    </div>
  );
}
