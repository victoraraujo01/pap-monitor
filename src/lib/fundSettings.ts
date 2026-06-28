import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/services/supabase'

// Política de dívida de resgate (global do fundo). NOMINAL = dívida em reais
// (trava o valor); PARTICIPACAO = dívida em cotas (restaura a fatia queimada, o
// equivalente em R$ oscila com a cota). Default NOMINAL. Fonte única reusada por
// MyPatrimony, AportesView e AdminView.
export type DebtMode = 'NOMINAL' | 'PARTICIPACAO'

export function useDebtMode() {
  const [mode, setMode] = useState<DebtMode>('NOMINAL')
  const [loading, setLoading] = useState(true)

  const reload = useCallback(() => {
    supabase
      .from('fund_settings')
      .select('debt_mode')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data }) => {
        setMode((data?.debt_mode as DebtMode) ?? 'NOMINAL')
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  return { mode, loading, reload }
}
