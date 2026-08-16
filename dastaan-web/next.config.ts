import type { NextConfig } from "next";

/* The web app is UI-only. All data and auth live in the dastaan-api
   service; /api/* is proxied server-side so the browser stays
   same-origin (no CORS, cookies just work). */
const API_URL = process.env.API_URL || "http://localhost:4000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/:path*` }];
  },
};

export default nextConfig;
