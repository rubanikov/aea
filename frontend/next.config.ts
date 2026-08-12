import type { NextConfig } from "next";

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
};

export default nextConfig;
