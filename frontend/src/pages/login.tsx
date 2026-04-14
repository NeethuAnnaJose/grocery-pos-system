import { useRouter } from 'next/router'

export default function Login() {
  const router = useRouter()

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="bg-white rounded-lg shadow p-6 w-full max-w-md text-center">
        <h1 className="text-xl font-semibold mb-2">Login Disabled</h1>
        <p className="text-sm text-gray-600 mb-4">Continue to dashboard.</p>
        <button className="btn btn-primary" onClick={() => router.push('/dashboard')}>
          Go to Dashboard
        </button>
      </div>
    </div>
  )
}
