import { useRouter } from 'next/router'

export default function Home() {
  const router = useRouter()

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
      <div className="bg-white rounded-lg shadow p-6 w-full max-w-md text-center">
        <h1 className="text-xl font-semibold mb-2">Grocery POS</h1>
        <p className="text-sm text-gray-600 mb-4">
          Choose where to continue.
        </p>
        <div className="flex flex-col gap-2">
          <button className="btn btn-primary" onClick={() => router.push('/dashboard')}>
            Go to Dashboard
          </button>
          <button className="btn btn-secondary" onClick={() => router.push('/login')}>
            Go to Login
          </button>
        </div>
      </div>
    </div>
  )
}
