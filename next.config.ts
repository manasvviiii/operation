import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.1.39"],

  serverExternalPackages: [
    "@napi-rs/canvas",
    "pdf-parse",
  ],

  // planner.ts's loadPrompt() reads prompts/planner/v1.md from the filesystem.
  // Explicitly include planner prompts in deployed API functions.
  outputFileTracingIncludes: {
    "/api/**/*": ["./prompts/**/*"],
  },
};

export default nextConfig;