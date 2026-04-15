import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { onAuthStateChanged } from 'firebase/auth'
import { getFirebaseAuth, hasFirebaseConfig } from '@/lib/firebase'

export const useRequireAuth = () => {
  const router = useRouter()
  const [authLoading, setAuthLoading] = useState(true)
  const [currentUserEmail, setCurrentUserEmail] = useState('')

  useEffect(() => {
    if (!hasFirebaseConfig) {
      const session = typeof window !== 'undefined' ? localStorage.getItem('local_auth_session_v1') : ''
      if (!session) {
        router.replace('/login').catch(() => {})
      } else {
        setCurrentUserEmail(session)
      }
      setAuthLoading(false)
      return
    }

    let unsubscribe: (() => void) | undefined
    try {
      const auth = getFirebaseAuth()
      unsubscribe = onAuthStateChanged(auth, (user) => {
        setCurrentUserEmail(user?.email || '')
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

  return { authLoading, currentUserEmail }
}
