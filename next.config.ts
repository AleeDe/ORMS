import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the isolated campaign preview separate from normal development/builds.
  distDir: process.env.ORMS_WORKFLOW_PREVIEW === "1" ? ".next-workflow-preview" : ".next",
};

export default nextConfig;
