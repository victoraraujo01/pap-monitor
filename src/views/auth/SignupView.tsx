import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { supabase } from '@/services/supabase'
import { useAuth } from '@/context/useAuth'
import { AuthShell, Field } from './LoginView'

// Cadastro por e-mail + senha. O `data.name` é essencial: o trigger
// handle_new_user lê raw_user_meta_data->>'name' para preencher profiles.name.
// Com enable_confirmations=false (config.toml de dev) o signUp já devolve sessão.
export function SignupView() {
  const { session, loading } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [needsConfirmation, setNeedsConfirmation] = useState(false)

  if (!loading && session) {
    return <Navigate to="/" replace />
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } },
    })
    if (error) {
      setError(error.message)
      setSubmitting(false)
      return
    }
    // Sem sessão na resposta = confirmação de e-mail ativada no servidor.
    if (!data.session) {
      setNeedsConfirmation(true)
      setSubmitting(false)
    }
  }

  if (needsConfirmation) {
    return (
      <AuthShell title="Confirme seu e-mail">
        <p className="text-sm text-slate-600">
          Enviamos um link de confirmação para <strong>{email}</strong>. Após
          confirmar, faça login.
        </p>
        <p className="mt-4 text-center text-sm text-slate-500">
          <Link to="/login" className="font-medium text-slate-900 underline">
            Ir para o login
          </Link>
        </p>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Criar conta">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field
          label="Nome"
          type="text"
          value={name}
          onChange={setName}
          autoComplete="name"
        />
        <Field
          label="E-mail"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
        />
        <Field
          label="Senha"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {submitting ? 'Criando…' : 'Criar conta'}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-500">
        Já tem conta?{' '}
        <Link to="/login" className="font-medium text-slate-900 underline">
          Entrar
        </Link>
      </p>
    </AuthShell>
  )
}
