import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["pg", "@neondatabase/serverless", "ws", "pdf-parse", "@napi-rs/canvas"],
  outputFileTracingExcludes: { "/*": ["./data/**/*", "./output/**/*", "./.env*"] },
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};
export default config;
