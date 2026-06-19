import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { supabase } from '@/services/supabase'
import { useAuth } from '@/context/useAuth'
import { AuthShell, Field, SubmitButton } from './LoginView'

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
        <p className="text-sm leading-relaxed text-bone-dim">
          Enviamos um link de confirmação para{' '}
          <strong className="text-bone">{email}</strong>. Após confirmar, faça
          login.
        </p>
        <p className="mt-5 text-center text-sm text-bone-dim">
          <Link
            to="/login"
            className="font-medium text-brass underline-offset-4 hover:underline"
          >
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
        {error && (
          <p className="rounded-lg border border-clay/40 bg-clay/10 px-3.5 py-2.5 text-sm text-clay">
            {error}
          </p>
        )}
        <SubmitButton submitting={submitting}>
          {submitting ? 'Criando…' : 'Criar conta'}
        </SubmitButton>
      </form>
      <p className="mt-6 text-center text-sm text-bone-dim">
        Já tem conta?{' '}
        <Link
          to="/login"
          className="font-medium text-brass underline-offset-4 hover:underline"
        >
          Entrar
        </Link>
      </p>
    </AuthShell>
  )
}
