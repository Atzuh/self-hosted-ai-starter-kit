/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1320px" },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },

        // Scriptor palette
        paper: {
          DEFAULT: "hsl(var(--paper))",
          strong: "hsl(var(--paper-strong))",
        },
        surface: "hsl(var(--surface))",
        wash: {
          DEFAULT: "hsl(var(--wash))",
          strong: "hsl(var(--wash-strong))",
        },
        ink: {
          DEFAULT: "hsl(var(--ink))",
          strong: "hsl(var(--ink-strong))",
          soft: "hsl(var(--ink-soft))",
          mute: "hsl(var(--ink-mute))",
          deep: "hsl(var(--ink-deep))",
          deeper: "hsl(var(--ink-deeper))",
        },
        azure: {
          DEFAULT: "hsl(var(--azure))",
          dark: "hsl(var(--azure-dark))",
          bright: "hsl(var(--azure-bright))",
          glow: "hsl(var(--azure-glow))",
          pale: "hsl(var(--azure-pale))",
        },
        seal: {
          DEFAULT: "hsl(var(--seal))",
          soft: "hsl(var(--seal-soft))",
          deep: "hsl(var(--seal-deep))",
        },
        line: {
          DEFAULT: "hsl(var(--line))",
          strong: "hsl(var(--line-strong))",
          dark: "hsl(var(--line-dark))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          pale: "hsl(var(--success-pale))",
        },
        danger: {
          DEFAULT: "hsl(var(--danger))",
          pale: "hsl(var(--danger-pale))",
        },
        amber: {
          DEFAULT: "hsl(var(--amber))",
          pale: "hsl(var(--amber-pale))",
        },
      },
      fontFamily: {
        display: [
          "'Fraunces'",
          "ui-serif",
          "Georgia",
          "serif",
        ],
        sans: [
          "'Inter'",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "sans-serif",
        ],
        mono: [
          "'JetBrains Mono'",
          "ui-monospace",
          "SFMono-Regular",
          "monospace",
        ],
      },
      fontSize: {
        "kicker": ["11px", { lineHeight: "1", letterSpacing: "0.14em", fontWeight: "600" }],
        "label": ["12px", { lineHeight: "1.4", letterSpacing: "0", fontWeight: "500" }],
        "meta": ["12.5px", { lineHeight: "1.5" }],
      },
      borderRadius: {
        lg: "calc(var(--radius) + 4px)",
        md: "var(--radius)",
        sm: "calc(var(--radius) - 2px)",
      },
      boxShadow: {
        card: "0 1px 0 hsla(0, 0%, 100%, 0.02) inset, 0 2px 8px hsla(220, 80%, 2%, 0.4), 0 14px 32px hsla(220, 80%, 2%, 0.35)",
        "card-hover":
          "0 1px 0 hsla(0, 0%, 100%, 0.04) inset, 0 4px 16px hsla(220, 80%, 2%, 0.5), 0 24px 48px hsla(220, 80%, 2%, 0.45)",
        ring: "0 0 0 1px hsl(var(--line))",
        "ring-strong": "0 0 0 1px hsl(var(--line-strong))",
        glow:
          "0 0 0 1px hsla(209, 95%, 60%, 0.45), 0 8px 32px hsla(209, 95%, 60%, 0.28)",
        "glow-seal":
          "0 0 0 1px hsla(36, 65%, 60%, 0.45), 0 8px 32px hsla(36, 65%, 60%, 0.25)",
        "inner-line": "inset 0 0 0 1px hsl(var(--line))",
      },
      keyframes: {
        "pulse-soft": {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.35", transform: "scale(0.85)" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(2px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "shimmer": {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        "pulse-soft": "pulse-soft 1.4s ease-in-out infinite",
        "fade-in": "fade-in 0.3s ease-out forwards",
        "fade-up": "fade-up 0.45s ease-out forwards",
        "shimmer": "shimmer 2.5s linear infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
