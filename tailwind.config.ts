import type { Config } from "tailwindcss";

/**
 * Every colour is a CSS variable (see app/globals.css), so the same class works
 * in the light and the dark theme. The palette is deliberately small: neutrals
 * for everything, and colour only for state — the four item states, plus
 * danger for destructive actions and errors.
 */
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: v("canvas"),
        surface: v("surface"),
        raised: v("raised"),
        border: v("border"),
        "border-strong": v("border-strong"),
        ink: v("ink"),
        muted: v("muted"),
        faint: v("faint"),
        pill: v("pill"),
        hover: v("hover"),
        active: v("ink"),
        "on-ink": v("on-ink"),
        state: {
          todo: v("state-todo"),
          doing: v("state-doing"),
          review: v("state-review"),
          done: v("state-done"),
          cancelled: v("state-cancelled"),
        },
        success: { DEFAULT: v("state-done"), bg: v("done-bg"), fg: v("state-done") },
        warn: { DEFAULT: v("state-doing"), bg: v("doing-bg"), fg: v("state-doing"), border: v("doing-border") },
        danger: { DEFAULT: v("danger"), bg: v("danger-bg"), fg: v("danger") },
        code: { bg: v("code-bg"), fg: v("ink") },
      },
      borderRadius: {
        xs: "3px",
        sm: "4px",
        md: "6px",
        lg: "8px",
        xl: "10px",
        "2xl": "14px",
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: {
        "2xs": ["10.5px", { lineHeight: "14px" }],
        xs: ["11.5px", { lineHeight: "16px" }],
        sm: ["12.5px", { lineHeight: "18px" }],
        base: ["13.5px", { lineHeight: "20px" }],
        md: ["15px", { lineHeight: "22px" }],
        lg: ["18px", { lineHeight: "24px" }],
        xl: ["22px", { lineHeight: "28px" }],
        "2xl": ["28px", { lineHeight: "34px" }],
      },
      boxShadow: {
        card: "0 1px 1px rgb(var(--shadow) / 0.04), 0 0 0 1px rgb(var(--shadow) / 0.02)",
        lift: "0 10px 30px -8px rgb(var(--shadow) / 0.28), 0 2px 6px rgb(var(--shadow) / 0.08)",
        panel: "-24px 0 60px -30px rgb(var(--shadow) / 0.35)",
        pop: "0 18px 50px -12px rgb(var(--shadow) / 0.35), 0 0 0 1px rgb(var(--shadow) / 0.04)",
      },
      keyframes: {
        "rb-pulse": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.45" },
        },
      },
      animation: {
        "rb-pulse": "rb-pulse 1.6s cubic-bezier(0.4,0,0.6,1) infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
