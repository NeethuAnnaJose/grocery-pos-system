import { configureStore } from '@reduxjs/toolkit'
import { persistStore, persistReducer } from 'redux-persist'
import storage from 'redux-persist/lib/storage'
import { combineReducers } from '@reduxjs/toolkit'

import authSlice from './slices/authSlice'
import cartSlice from './slices/cartSlice'
import uiSlice from './slices/uiSlice'

const persistConfig = {
  key: 'root',
  storage,
  whitelist: ['auth', 'cart'], // only persist auth and cart
}

const rootReducer = combineReducers({
  auth: authSlice,
  cart: cartSlice,
  ui: uiSlice,
})

const persistedReducer = persistReducer(persistConfig, rootReducer)

export const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: ['persist/PERSIST', 'persist/REHYDRATE'],
      },
    }),
  devTools: process.env.NODE_ENV !== 'production',
})

export const persistor = persistStore(store)

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
