/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  env: {
    APP_VERSION: require('./package.json').version,
  },
  async rewrites() {
    // Proxy browser /api/* to the Express backend (default port 3000). Override with BACKEND_URL.
    const backend = (process.env.BACKEND_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
    return [
      {
        source: '/api/:path*',
        destination: `${backend}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
