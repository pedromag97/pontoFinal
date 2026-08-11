import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: { ignoreDuringBuilds: true },
  async redirects() {
    return [
      // URL antigo (francês) → novo, para apps instaladas/atalhos antigos.
      { source: "/pointage", destination: "/registo", permanent: true },
      {
        source: "/pointage/:path*",
        destination: "/registo/:path*",
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        // The service worker must never be cached, so updates roll out immediately.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
