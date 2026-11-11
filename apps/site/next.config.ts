import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Plain files served by a static Caddy container: no Next server in production.
  output: "export",
  // The default image loader needs a server.
  images: { unoptimized: true },
  experimental: {
    // Two root layouts (one per <html lang>) leave no single layout for a 404 page:
    // app/global-not-found.tsx renders the whole document instead, exported as 404.html.
    globalNotFound: true,
  },
};

export default nextConfig;
