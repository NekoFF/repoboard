import type { Config } from "tailwindcss";

// Tokens extracted directly from the RepoBoard Figma file
// (figma.com/design/xUVcoqZ9kKqiwv2sEEJAwk) — do not invent new colors here.
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#fbfbfa",
        surface: "#ffffff",
        border: "#e0e0de",
        ink: "#121213",
        muted: "#66666b",
        pill: "#f4f4f2",
        active: "#1a1a1c",
        success: { bg: "#edf7f0", fg: "#2e7847" },
        warn: { bg: "#fcf2e0", fg: "#b8731a", border: "#e8c785" },
        danger: { fg: "#ad332e" },
        code: { bg: "#121213", fg: "#e6e6e6" },
      },
      borderRadius: {
        sm: "6px",
        md: "7px",
        lg: "8px",
        xl: "9px",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(18,18,19,0.04)",
        lift: "0 8px 24px -6px rgba(18,18,19,0.18), 0 2px 6px rgba(18,18,19,0.06)",
        panel: "-16px 0 48px -24px rgba(18,18,19,0.25)",
        pop: "0 16px 48px -12px rgba(18,18,19,0.28)",
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
