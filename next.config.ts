import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  allowedDevOrigins: ['192.168.1.39'],

  outputFileTracingIncludes: {
    '/api/**/*': [
      './prompts/**/*',
      './node_modules/tesseract.js/src/worker-script/node/**/*',
      './node_modules/tesseract-core/**/*',
    ],
  },

  serverExternalPackages: [
    'tesseract.js',
    'tesseract-core',
  ],
};

export default nextConfig;