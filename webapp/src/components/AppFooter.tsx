interface AppFooterProps {
  version?: string;
  template?: string;
  n8nStatus?: "online" | "offline";
}

const ROMAN: Array<[number, string]> = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
  [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];

function toRoman(n: number) {
  let out = "";
  for (const [value, symbol] of ROMAN) {
    while (n >= value) {
      out += symbol;
      n -= value;
    }
  }
  return out;
}

// Romeinse arcade: een rij rondbogen op pilasters, zoals een aquaduct.
function ArcadeBand() {
  return (
    <svg
      className="block h-[11px] w-full text-line-strong"
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      <defs>
        <pattern
          id="footer-arcade"
          width="13"
          height="11"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M0 0.9H13M1.7 10.4V6.1a4.8 4.8 0 0 1 9.6 0v4.3"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.9"
            strokeLinecap="square"
          />
        </pattern>
      </defs>
      <rect width="100%" height="11" fill="url(#footer-arcade)" />
    </svg>
  );
}

// Klein lauwertakje; `flip` spiegelt het voor de rechterkant.
function LaurelSprig({ flip = false }: { flip?: boolean }) {
  return (
    <svg
      viewBox="0 0 16 10"
      className="h-2.5 w-4 text-seal"
      style={flip ? { transform: "scaleX(-1)" } : undefined}
      aria-hidden="true"
      fill="currentColor"
    >
      <path
        d="M1 9C5 8.5 10 6.5 15 2"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.8"
        strokeLinecap="round"
      />
      <ellipse cx="4.5" cy="6.4" rx="1.9" ry="0.8" transform="rotate(-60 4.5 6.4)" />
      <ellipse cx="5.8" cy="9" rx="1.9" ry="0.8" transform="rotate(10 5.8 9)" />
      <ellipse cx="8.8" cy="4.6" rx="1.9" ry="0.8" transform="rotate(-70 8.8 4.6)" />
      <ellipse cx="10.4" cy="7" rx="1.9" ry="0.8" transform="rotate(0 10.4 7)" />
      <ellipse cx="14.6" cy="1.8" rx="1.9" ry="0.8" transform="rotate(-35 14.6 1.8)" />
    </svg>
  );
}

// Romeinse interpunct: een verhoogde punt als scheiding.
function Interpunct() {
  return (
    <span aria-hidden="true" className="select-none text-seal">
      ·
    </span>
  );
}

export function AppFooter({
  version = "0.1.0",
  template = "HYRABO00 · H1-2018",
  n8nStatus = "online",
}: AppFooterProps) {
  const isOnline = n8nStatus === "online";
  const year = new Date().getFullYear();

  return (
    <footer className="mt-auto bg-paper/60">
      <ArcadeBand />
      <div className="mx-auto flex max-w-[1400px] flex-col items-start justify-between gap-2 px-4 py-3.5 text-[11.5px] text-ink-soft sm:flex-row sm:items-center sm:px-8">
        <div className="flex items-center gap-4">
          <div className="font-mono text-ink">Template · {template}</div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5">
              {isOnline && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
              )}
              <span
                className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
                  isOnline ? "bg-success" : "bg-danger"
                }`}
              />
            </span>
            <span className="font-medium">n8n · {n8nStatus}</span>
          </div>
          <Interpunct />
          <div className="flex items-center gap-1.5 font-mono text-ink-soft">
            <LaurelSprig />
            <span>Scriptor v{version}</span>
            <LaurelSprig flip />
          </div>
          <Interpunct />
          <div
            className="font-display tracking-[0.18em] text-ink-soft"
            title={String(year)}
          >
            {toRoman(year)}
          </div>
        </div>
      </div>
    </footer>
  );
}
