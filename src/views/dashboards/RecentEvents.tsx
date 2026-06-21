import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/services/supabase'
import { Card } from '@/components/ui'
import { formatBRL, formatDate } from '@/lib/format'
import { EVENT_SELECT, TYPE_LABELS, type EventRow } from '@/lib/events'

// Prévia do livro de lançamentos: os 5 eventos mais recentes + atalho para a
// página completa de histórico (auditoria, filtros e edição/remoção).
export function RecentEvents() {
  const [events, setEvents] = useState<EventRow[]>([])
  const [profiles, setProfiles] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('transactions')
      .select(EVENT_SELECT)
      .order('event_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(5)
      .then(({ data }) => {
        setEvents((data ?? []) as EventRow[])
        setLoading(false)
      })
    supabase
      .from('profiles')
      .select('id, name')
      .then(({ data }) =>
        setProfiles(new Map((data ?? []).map((p) => [p.id, p.name]))),
      )
  }, [])

  return (
    <Card
      title="Lançamentos"
      description="Os últimos eventos do fundo — aportes, resgates e despesas. O histórico completo permite filtrar, auditar, editar e remover lançamentos."
    >
      {loading ? (
        <p className="text-sm text-bone-dim">Carregando…</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-bone-dim">Nenhum evento ainda.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="eyebrow pb-2 text-sage">Data</th>
              <th className="eyebrow pb-2 text-sage">Cotista</th>
              <th className="eyebrow pb-2 text-sage">Tipo</th>
              <th className="eyebrow pb-2 text-right text-sage">Valor</th>
            </tr>
          </thead>
          <tbody>
            {events.map((ev) => (
              <tr key={ev.id} className="border-t border-line">
                <td className="nums py-2.5 text-bone-dim">
                  {formatDate(ev.event_date)}
                </td>
                <td className="py-2.5 text-bone-dim">
                  {ev.profile_id ? (profiles.get(ev.profile_id) ?? '—') : '—'}
                </td>
                <td className="py-2.5 text-bone">
                  {TYPE_LABELS[ev.type] ?? ev.type}
                  {ev.is_opening && (
                    <span className="eyebrow ml-2 rounded-full border border-brass/30 px-1.5 py-0.5 text-[0.5rem] text-brass-bright">
                      abertura
                    </span>
                  )}
                </td>
                <td className="nums py-2.5 text-right text-bone">
                  {formatBRL(ev.amount_brl)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="mt-5">
        <Link
          to="/historico"
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3.5 py-2 text-sm font-medium text-bone-dim transition-colors hover:border-brass/50 hover:text-bone"
        >
          Ver tudo
          <span aria-hidden>→</span>
        </Link>
      </div>
    </Card>
  )
}
