import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverBodySizeLimit: "50mb",
  },
};

export default nextConfig;
