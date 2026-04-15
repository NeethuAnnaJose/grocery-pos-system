import Link from 'next/link'
import { useRouter } from 'next/router'
import toast from 'react-hot-toast'
import { signOut } from 'firebase/auth'
import { getFirebaseAuth, hasFirebaseConfig } from '@/lib/firebase'

type AppHeaderProps = {
  active: 'inventory' | 'billing'
  userEmail?: string
}

export const AppHeader = ({ active, userEmail }: AppHeaderProps) => {
  const router = useRouter()

  const handleLogout = async () => {
    try {
      if (hasFirebaseConfig) {
        await signOut(getFirebaseAuth())
      } else if (typeof window !== 'undefined') {
        localStorage.removeItem('local_auth_session_v1')
      }
      toast.success('Signed out')
      router.push('/login').catch(() => {})
    } catch (error: any) {
      toast.error(error?.message || 'Sign out failed')
    }
  }

  const activeClass = 'bg-blue-600 text-white'
  const inactiveClass = 'bg-white text-gray-700 border border-gray-300'

  return (
    <header className="sticky top-0 z-20 bg-white border-b border-gray-200">
      <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap gap-2 items-center justify-between">
        <div className="flex items-center gap-2">
          <Link
            href="/inventory"
            className={`px-3 py-2 text-sm font-semibold rounded ${active === 'inventory' ? activeClass : inactiveClass}`}
          >
            Inventory
          </Link>
          <Link
            href="/billing"
            className={`px-3 py-2 text-sm font-semibold rounded ${active === 'billing' ? activeClass : inactiveClass}`}
          >
            Billing
          </Link>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs sm:text-sm text-gray-600">{userEmail || 'Signed in user'}</span>
          <button className="btn btn-outline btn-sm" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </div>
    </header>
  )
}
