import { FirebaseApp, FirebaseOptions, getApp, getApps, initializeApp } from 'firebase/app'
import { Firestore, getFirestore } from 'firebase/firestore'

const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

const assertFirebaseConfig = () => {
  if (!firebaseConfig.apiKey || !firebaseConfig.projectId || !firebaseConfig.appId) {
    throw new Error(
      'Firebase env is missing. Set NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_PROJECT_ID, and NEXT_PUBLIC_FIREBASE_APP_ID.'
    )
  }
}

export const getFirebaseApp = (): FirebaseApp => {
  assertFirebaseConfig()
  if (getApps().length > 0) {
    return getApp()
  }
  return initializeApp(firebaseConfig)
}

export const getDb = (): Firestore => getFirestore(getFirebaseApp())
