import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@flight-lens/contracts", "@flight-lens/domain"],
};

export default nextConfig;
