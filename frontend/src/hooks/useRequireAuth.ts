import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { User, onAuthStateChanged } from 'firebase/auth'
import { getFirebaseAuth } from '@/lib/firebase'

export const useRequireAuth = () => {
  const router = useRouter()
  const [authLoading, setAuthLoading] = useState(true)
  const [currentUser, setCurrentUser] = useState<User | null>(null)

  useEffect(() => {
    let unsubscribe: (() => void) | undefined
    try {
      const auth = getFirebaseAuth()
      unsubscribe = onAuthStateChanged(auth, (user) => {
        setCurrentUser(user)
        setAuthLoading(false)
        if (!user) {
          router.replace('/login').catch(() => {})
        }
      })
    } catch {
      setAuthLoading(false)
      router.replace('/login').catch(() => {})
    }
    return () => {
      if (unsubscribe) unsubscribe()
    }
  }, [router])

  return { authLoading, currentUser }
}
