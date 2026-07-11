import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  allowedDevOrigins: ['192.168.1.39'],

  // planner.ts's loadPrompt() reads prompts/planner/v1.md off the filesystem
  // at runtime via fs.readFileSync. Vercel's serverless bundler only includes
  // files it can statically trace, and a loose folder like prompts/ (outside
  // src/app or src/lib) can get silently dropped from the deployed function.
  // This explicitly forces it to be bundled for any API route that might
  // (directly or transitively, e.g. via runAgentLoop -> planNext) need it.
  outputFileTracingIncludes: {
    '/api/**/*': ['./prompts/**/*'],
  },
};

export default nextConfig;