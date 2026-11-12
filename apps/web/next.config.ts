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
        source: '/stockfish/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
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
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
