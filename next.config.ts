import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    // Allow build even if there are ESLint errors (e.g., "no-explicit-any")
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Still fail build if TypeScript finds type errors
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
