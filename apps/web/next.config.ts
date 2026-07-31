import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: [
    "@flight-lens/api",
    "@flight-lens/connectors",
    "@flight-lens/contracts",
    "@flight-lens/database",
    "@flight-lens/domain",
  ],
};

export default nextConfig;
