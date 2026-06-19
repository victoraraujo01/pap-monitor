import { useContext } from 'react'
import { AuthContext } from './auth-context'

// Acesso ao estado de autenticação. Lança se usado fora do <AuthProvider>.
// Hook isolado em arquivo próprio para não violar react-refresh/only-export-components.
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (ctx === undefined) {
    throw new Error('useAuth deve ser usado dentro de <AuthProvider>')
  }
  return ctx
}
