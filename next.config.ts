import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: true },
  serverExternalPackages: ["unpdf", "otplib", "qrcode", "better-sqlite3"],
  devIndicators: false,
  async rewrites() {
    return [
      { source: "/generated/:name*", destination: "/api/media/generated/:name*" },
      { source: "/outputs/:name*", destination: "/api/media/outputs/:name*" },
    ];
  },
};

export default nextConfig;
