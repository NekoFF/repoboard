/** @type {import('next').NextConfig} */
const nextConfig = {
  // Production builds get their own directory: running `npm run build` while
  // `npm run dev` is up used to overwrite .next and leave the dev server
  // serving HTML that pointed at CSS chunks which no longer existed.
  // NEXT_DIST_DIR lets a second dev server run from the same folder (for
  // example against a throwaway database) without the two fighting over .next.
  distDir:
    process.env.NEXT_DIST_DIR ?? (process.env.NODE_ENV === "production" ? ".next-build" : ".next"),
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3"],
  },
};

export default nextConfig;
