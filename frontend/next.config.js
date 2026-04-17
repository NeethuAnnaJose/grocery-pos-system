/** @type {import('next').NextConfig} */
const publicApiUrl = (process.env.NEXT_PUBLIC_API_URL || '').trim()
if (process.env.NODE_ENV === 'production' && !publicApiUrl) {
  throw new Error(
    'Set NEXT_PUBLIC_API_URL for production (public API origin only, e.g. https://api.yourdomain.com). ' +
      'Leaving it empty makes the app use /api on the same host, which cannot reach your backend on a live server.'
  )
}

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
    // When NEXT_PUBLIC_API_URL is set, the browser calls the API host directly (required for typical live deploys).
    if (publicApiUrl) {
      return []
    }

    return [
      {
        source: '/api/:path*',
        // Must match backend default (PORT 5000 in backend/src/index.js).
        destination: process.env.INTERNAL_API_PROXY || 'http://127.0.0.1:5000/api/:path*',
      },
    ]
  },
}

module.exports = nextConfig
