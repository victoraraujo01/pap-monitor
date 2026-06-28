import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/services/supabase'
import { useDebtMode } from '@/lib/fundSettings'

// Saldo de resgate a repor + valor da mensalidade corrente de um cotista — insumos
// da divisão do aporte (obrigação × reposição). `outstanding` é SEMPRE em R$ (a
// reposição no aporte é em reais): no modo NOMINAL é o valor nominal; no modo
// PARTICIPACAO é o equivalente em R$ HOJE das cotas em aberto (cotas × cota
// corrente) — o que o cotista precisa aportar agora para restaurar a fatia.
// Habilitado só quando faz sentido (APORTE). `reload` refaz a busca após gravar.
export function useRepayment(profileId: string | null, enabled: boolean) {
  const { mode } = useDebtMode()
  const [outstanding, setOutstanding] = useState(0)
  const [monthly, setMonthly] = useState(1000)

  const reload = useCallback(() => {
    if (!enabled || !profileId) return
    Promise.all([
      supabase
        .from('v_cotista_balance')
        .select('repayment_outstanding, repayment_outstanding_cotas')
        .eq('profile_id', profileId)
        .maybeSingle(),
      supabase
        .from('pl_history')
        .select('quota_price')
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]).then(([bal, pl]) => {
      const nominal = bal.data?.repayment_outstanding ?? 0
      const cotas = bal.data?.repayment_outstanding_cotas ?? 0
      // Bootstrap da cota = R$1,00 quando não há histórico ainda.
      const quota = pl.data?.quota_price ?? 1
      const value = mode === 'PARTICIPACAO' ? cotas * quota : nominal
      setOutstanding(Math.max(0, value))
    })
    supabase
      .from('v_monthly_obligations')
      .select('amount_expected')
      .eq('profile_id', profileId)
      .order('reference_month', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setMonthly(data?.amount_expected ?? 1000))
  }, [profileId, enabled, mode])

  useEffect(() => {
    reload()
  }, [reload])

  return { outstanding, monthly, reload }
}
