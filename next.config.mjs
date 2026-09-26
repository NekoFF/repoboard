/** @type {import('next').NextConfig} */
const nextConfig = {
  // Production builds get their own directory: running `npm run build` while
  // `npm run dev` is up used to overwrite .next and leave the dev server
  // serving HTML that pointed at CSS chunks which no longer existed.
  // NEXT_DIST_DIR lets a second dev server run from the same folder (for
  // example against a throwaway database) without the two fighting over .next.
  distDir:
    process.env.NEXT_DIST_DIR ?? (process.env.NODE_ENV === "production" ? ".next-build" : ".next"),
  // The desktop app ships the server as a self-contained folder (desktop/prepare.mjs).
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3"],
    // Every page reads the local database, so a page the browser kept from an
    // earlier visit is out of date — a new board missing from Boards for up to
    // 30 seconds. Always ask the server again.
    staleTimes: { dynamic: 0 },
  },
};

export default nextConfig;
