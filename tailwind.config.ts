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
      },
    },
  },
  plugins: [],
} satisfies Config;
