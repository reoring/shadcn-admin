import { create } from 'zustand'
import { type AuthSession, getSession } from '@/lib/auth-client'

interface AuthState {
  auth: {
    session: AuthSession | null
    isLoading: boolean
    fetchSession: () => Promise<void>
    reset: () => void
  }
}

export const useAuthStore = create<AuthState>()((set) => ({
  auth: {
    session: null,
    isLoading: true,
    fetchSession: async () => {
      set((state) => ({
        auth: { ...state.auth, isLoading: true },
      }))
      const session = await getSession()
      set((state) => ({
        auth: { ...state.auth, session, isLoading: false },
      }))
    },
    reset: () =>
      set((state) => ({
        auth: { ...state.auth, session: null, isLoading: false },
      })),
  },
}))
