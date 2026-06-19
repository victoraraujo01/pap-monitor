import { createContext } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { Tables } from '@/services/supabase'

// Estado de autenticação disponível em todo o app via `useAuth()`.
// - `session`: sessão Supabase (null = deslogado).
// - `profile`: linha de `public.profiles` do usuário logado. Pode chegar DEPOIS
//   da sessão (busca assíncrona), então trate `null` enquanto carrega.
// - `loading`: true até a checagem inicial de sessão terminar.
// - `signOut`: encerra a sessão.
export interface AuthState {
  session: Session | null
  profile: Tables<'profiles'> | null
  loading: boolean
  signOut: () => Promise<void>
}

// `undefined` como default sinaliza "fora do provider" — o hook `useAuth` lança
// nesse caso. Mantido sem JSX para não violar react-refresh/only-export-components.
export const AuthContext = createContext<AuthState | undefined>(undefined)
