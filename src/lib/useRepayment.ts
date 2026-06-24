import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/services/supabase'

// Saldo de resgate a repor (Σ resgate − Σ reposição) + valor da mensalidade
// corrente de um cotista — insumos da divisão do aporte (obrigação × reposição).
// Habilitado só quando faz sentido (APORTE). `reload` permite refazer a busca
// depois de gravar uma operação. Fonte única reusada por AportesView e pelos
// modais do histórico.
export function useRepayment(profileId: string | null, enabled: boolean) {
  const [outstanding, setOutstanding] = useState(0)
  const [monthly, setMonthly] = useState(1000)

  const reload = useCallback(() => {
    if (!enabled || !profileId) return
    supabase
      .from('v_cotista_balance')
      .select('repayment_outstanding')
      .eq('profile_id', profileId)
      .maybeSingle()
      .then(({ data }) =>
        setOutstanding(Math.max(0, data?.repayment_outstanding ?? 0)),
      )
    supabase
      .from('v_monthly_obligations')
      .select('amount_expected')
      .eq('profile_id', profileId)
      .order('reference_month', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setMonthly(data?.amount_expected ?? 1000))
  }, [profileId, enabled])

  useEffect(() => {
    reload()
  }, [reload])

  return { outstanding, monthly, reload }
}
