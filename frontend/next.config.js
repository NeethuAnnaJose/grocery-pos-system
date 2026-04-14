/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  allowedDevOrigins: [
    'https://*.loca.lt',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
  ],
  images: {
    domains: ['localhost'],
  },
  async rewrites() {
    // In production, frontend should call backend using NEXT_PUBLIC_API_URL directly.
    if (process.env.NEXT_PUBLIC_API_URL) {
      return []
    }

    return [
      {
        source: '/api/:path*',
        destination: process.env.INTERNAL_API_PROXY || 'http://127.0.0.1:5001/api/:path*',
      },
    ]
  },
}

module.exports = nextConfig
