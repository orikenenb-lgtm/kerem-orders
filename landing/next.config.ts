import type { NextConfig } from "next";

// Static export for GitHub Pages. The site is served from a project subpath
// (https://<user>.github.io/kerem-orders/), so basePath/assetPrefix are applied
// in production builds only — local `npm run dev` stays at the root.
const isProd = process.env.NODE_ENV === "production";
const basePath = isProd ? "/kerem-orders" : "";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  assetPrefix: basePath,
  images: { unoptimized: true },
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default nextConfig;
