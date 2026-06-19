import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/services/supabase'
import type { Tables } from '@/services/supabase'
import { AuthContext } from './auth-context'

// Provedor de sessão+perfil. Monta a sessão inicial, escuta mudanças de auth e
// mantém o perfil (`public.profiles`) sincronizado com o usuário logado.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Tables<'profiles'> | null>(null)
  const [loading, setLoading] = useState(true)

  // Checagem inicial + assinatura das mudanças de auth.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })

    return () => subscription.unsubscribe()
  }, [])

  // Sempre que a sessão muda, recarrega (ou limpa) o perfil correspondente.
  // O setState só ocorre de forma assíncrona (dentro do .then) para não disparar
  // renders em cascata — daí o ramo "sem usuário" resolver para null.
  useEffect(() => {
    const userId = session?.user.id
    let cancelled = false

    const loadProfile = async () => {
      if (!userId) return null
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()
      return data
    }

    loadProfile().then((data) => {
      if (!cancelled) setProfile(data)
    })

    return () => {
      cancelled = true
    }
  }, [session?.user.id])

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ session, profile, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
