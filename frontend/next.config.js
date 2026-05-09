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
    return [
      {
        source: '/api/:path*',
        destination: process.env.NODE_ENV === 'development' 
          ? 'http://localhost:3000/api/:path*'
          : process.env.API_URL 
            ? `${process.env.API_URL}/api/:path*`
            : 'https://chuyen-gia-crypto-backend.onrender.com/api/:path*',
      },
    ];
  },
};

module.exports = nextConfig;
