import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { supabase } from '@/services/supabase'
import { useAuth } from '@/context/useAuth'

// Login por e-mail + senha. No sucesso, o onAuthStateChange atualiza a sessão e
// o <Navigate> abaixo leva ao app — não precisamos navegar manualmente.
export function LoginView() {
  const { session, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (!loading && session) {
    return <Navigate to="/" replace />
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    if (error) {
      setError(error.message)
      setSubmitting(false)
    }
  }

  return (
    <AuthShell title="Entrar no fundo">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
          autoComplete="current-password"
        />
        {error && (
          <p className="rounded-lg border border-clay/40 bg-clay/10 px-3.5 py-2.5 text-sm text-clay">
            {error}
          </p>
        )}
        <SubmitButton submitting={submitting}>
          {submitting ? 'Entrando…' : 'Entrar'}
        </SubmitButton>
      </form>
      <p className="mt-6 text-center text-sm text-bone-dim">
        Não tem conta?{' '}
        <Link
          to="/signup"
          className="font-medium text-brass underline-offset-4 hover:underline"
        >
          Cadastre-se
        </Link>
      </p>
    </AuthShell>
  )
}

// --- helpers compartilhados pelas telas de auth ---

export function AuthShell({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="animate-rise w-full max-w-sm">
        {/* Brasão / cabeçalho do certificado */}
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-lg border border-brass/50 font-display text-lg font-semibold text-brass shadow-[0_0_40px_-12px_rgba(201,162,74,0.6)]">
            P
          </span>
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-bone">
              Fundo PAP
            </h1>
            <p className="overline mt-1 text-sage">
              Projeto Aposentadoria Pais
            </p>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-line bg-moss/70 p-7 shadow-[0_24px_70px_-40px_rgba(0,0,0,0.9)] backdrop-blur-sm">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brass/60 to-transparent" />
          <p className="overline mb-5 text-center text-sage">{title}</p>
          {children}
        </div>
      </div>
    </div>
  )
}

export function SubmitButton({
  submitting,
  children,
}: {
  submitting: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="submit"
      disabled={submitting}
      className="mt-1 rounded-lg bg-gradient-to-b from-brass-bright to-brass px-3 py-2.5 text-sm font-semibold tracking-tight text-void shadow-[0_8px_24px_-12px_rgba(201,162,74,0.7)] transition-all hover:from-brass hover:to-brass-bright disabled:opacity-50"
    >
      {children}
    </button>
  )
}

export function Field({
  label,
  type,
  value,
  onChange,
  autoComplete,
}: {
  label: string
  type: string
  value: string
  onChange: (v: string) => void
  autoComplete?: string
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="overline text-sage">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        required
        className="w-full rounded-lg border border-line bg-void/60 px-3 py-2.5 text-sm text-bone placeholder:text-sage/60 transition-colors focus:border-brass/70 focus:outline-none focus:ring-1 focus:ring-brass/40"
      />
    </label>
  )
}
