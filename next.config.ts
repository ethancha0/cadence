import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A package-lock.json in the home directory confuses workspace-root detection.
  turbopack: { root: __dirname },
};

export default nextConfig;
