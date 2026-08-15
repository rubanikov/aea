import type { NextConfig } from "next";
import { backendOrigin } from "./lib/api/backend-origin";
import { apiProxyRewrites } from "./lib/api/proxy-rewrites";

const nextConfig: NextConfig = {
  /* Clickjacking protection: this app has no legitimate embedding use case,
     so refuse to render in any frame. `frame-ancestors` is the modern CSP
     control; `X-Frame-Options` covers older user agents. */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
  async rewrites() {
    // Locally NEXT_PUBLIC_API_URL points at Django on another port of
    // localhost, and cookies are host-only on `localhost` (port is not part
    // of the cookie host) so a rewrite is unnecessary. On Railway the two
    // `*.up.railway.app` hosts are different sites — rewrite so the browser
    // only talks to this origin.
    if (!process.env.RAILWAY_SERVICE_BACKEND_URL && !process.env.BACKEND_URL) {
      return [];
    }
    return apiProxyRewrites(backendOrigin());
  },
};

export default nextConfig;
