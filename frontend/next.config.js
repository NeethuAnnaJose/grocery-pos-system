/** @type {import('next').NextConfig} */
const publicApiUrl = (process.env.NEXT_PUBLIC_API_URL || '').trim()
// Do not throw here: Vercel/CI builds often run before env vars are added, which would block every deploy.
// For a working live API, set NEXT_PUBLIC_API_URL in the host dashboard (e.g. Vercel → Settings → Environment Variables).
if (process.env.NODE_ENV === 'production' && !publicApiUrl) {
  console.warn(
    '[grocery-pos] NEXT_PUBLIC_API_URL is empty. Browser calls will use same-origin /api. ' +
      'On Vercel, add NEXT_PUBLIC_API_URL = your API origin (e.g. https://your-backend.onrender.com), apply to Production, then redeploy.'
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
