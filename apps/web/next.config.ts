import type { NextConfig } from "next";
import dns from 'node:dns';

// Fix Node.js fetch ETIMEDOUT on IPv6
dns.setDefaultResultOrder('ipv4first');

const nextConfig: NextConfig = {
  transpilePackages: [
    '@chess-analyzer/ui',
    '@chess-analyzer/chess-core',
    '@fortawesome/react-fontawesome',
    '@fortawesome/fontawesome-svg-core',
    '@fortawesome/free-solid-svg-icons',
  ],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'credentialless',
          },
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
