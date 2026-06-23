import { useEffect, useState } from 'react'
import { supabase } from '@/services/supabase'
import { useAuth } from '@/context/useAuth'
import { Card } from '@/components/ui'
import { formatBRL, formatQuotas } from '@/lib/format'
import { BarList, type BarItem } from './charts'

type Profile = { id: string; name: string }
type Tx = {
  profile_id: string | null
  type: string
  amount_brl: number
  quotas_amount: number
}

type Stake = {
  id: string
  name: string
  quotas: number
  netContributed: number
}

// CdU 7 — Comparativo entre cotistas: fatia de cada irmão no fundo e o total
// aportado líquido (aportes − resgates pessoais).
export function Participation() {
  const { profile } = useAuth()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [txs, setTxs] = useState<Tx[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      supabase.from('profiles').select('id, name'),
      supabase
        .from('transactions')
        .select('profile_id, type, amount_brl, quotas_amount')
        .eq('status', 'APPROVED'),
    ]).then(([p, t]) => {
      setProfiles((p.data as Profile[] | null) ?? [])
      setTxs((t.data as Tx[] | null) ?? [])
      setLoading(false)
    })
  }, [])

  const stakes: Stake[] = profiles
    .map((pr) => {
      const mine = txs.filter((t) => t.profile_id === pr.id)
      const quotas = mine.reduce((s, t) => s + t.quotas_amount, 0)
      const netContributed = mine.reduce((s, t) => {
        if (t.type === 'APORTE') return s + t.amount_brl
        if (t.type === 'RESGATE_PESSOAL') return s - t.amount_brl
        return s
      }, 0)
      return { id: pr.id, name: pr.name, quotas, netContributed }
    })
    .sort((a, b) => b.quotas - a.quotas)

  const totalQuotas = stakes.reduce((s, st) => s + st.quotas, 0)

  const participation: BarItem[] = stakes.map((st) => {
    const frac = totalQuotas > 0 ? st.quotas / totalQuotas : 0
    const isMe = st.id === profile?.id
    return {
      label: isMe ? `${st.name} (você)` : st.name,
      value:
        totalQuotas > 0
          ? `${(frac * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
          : '—',
      fraction: frac,
      tone: isMe ? 'emerald' : 'brass',
      muted: isMe,
      // Valores antes na tabela inferior, agora sob a própria barra.
      meta: `${formatBRL(st.netContributed)} aportado · ${formatQuotas(st.quotas)} cotas`,
    }
  })

  return (
    <Card
      title="Participação dos cotistas"
      description="Fatia de cada irmão = cotas individuais ÷ total de cotas do fundo, com o total aportado (aportes − resgates pessoais)."
    >
      {loading ? (
        <p className="text-sm text-bone-dim">Carregando…</p>
      ) : totalQuotas <= 0 ? (
        <p className="text-sm text-bone-dim">
          Ainda não há cotas aprovadas no fundo.
        </p>
      ) : (
        <BarList items={participation} />
      )}
    </Card>
  )
}
