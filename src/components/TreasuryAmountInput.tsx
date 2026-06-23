import { useEffect, useRef, useState } from 'react'
import { Field, NumberInput } from '@/components/ui'
import { formatBRL } from '@/lib/format'
import { fetchPriceOn, today } from '@/lib/prices'

// Apara o ruído de ponto flutuante (preços têm 2 casas; cotas/qtd até 6).
function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6
}

// Entrada padronizada de operação com título do Tesouro: quantidade + dois campos
// interligados (preço unitário ↔ valor total). A VERDADE armazenada é sempre o par
// `quantidade + valor total` (espelha o que as RPCs gravam); o preço unitário é só
// derivado/editável. Editar o unitário recalcula o total (= qtd × unitário); editar
// o total recalcula o unitário (= total / qtd) — "o último editado manda". O unitário
// traz um chip de sugestão com o preço do título na data (pap_price_on via
// bond_price_history), no mesmo padrão da tela de saldo de abertura.
export function TreasuryAmountInput({
  quantity,
  amount,
  onQuantityChange,
  onAmountChange,
  bondId,
  date,
  defaultMode = 'total',
  quantityLabel = 'Quantidade',
  quantityHint,
  amountLabel = 'Valor total (R$)',
  amountHint,
  quantityPlaceholder = '0,000000',
  unitPlaceholder = 'Preço unit.',
  amountPlaceholder = '0,00',
  quantityRequired = true,
  amountRequired = true,
  className,
}: {
  quantity: string
  amount: string
  onQuantityChange: (v: string) => void
  onAmountChange: (v: string) => void
  bondId: string
  // Data do evento ('' = hoje). Define a referência do chip de preço.
  date: string
  // Qual dos dois campos lidera por padrão (saldo de abertura pensa em PU = 'unit').
  defaultMode?: 'total' | 'unit'
  quantityLabel?: string
  quantityHint?: string
  amountLabel?: string
  amountHint?: string
  quantityPlaceholder?: string
  unitPlaceholder?: string
  amountPlaceholder?: string
  quantityRequired?: boolean
  amountRequired?: boolean
  className?: string
}) {
  // 'total' = usuário digitou o valor total; 'unit' = digitou/aplicou o preço unitário.
  const [mode, setMode] = useState<'total' | 'unit'>(defaultMode)
  const [unitDraft, setUnitDraft] = useState('')
  const [hint, setHint] = useState<number | null>(null)
  const [hintLoading, setHintLoading] = useState(false)
  // Trava o auto-preenchimento da sugestão depois que o usuário toca em qualquer
  // campo. Montar já com valores (ex.: edição de um lançamento existente) conta como
  // "tocado" — não sobrescrevemos o valor que está sendo editado.
  const editedRef = useRef(quantity !== '' || amount !== '')

  const qtyNum = Number(quantity)
  const amountNum = Number(amount)

  // Preço unitário exibido: o rascunho quando o usuário lidera pelo unitário; senão
  // derivado de total / quantidade.
  const unitDisplay =
    mode === 'unit'
      ? unitDraft
      : qtyNum > 0 && amountNum > 0
        ? String(round6(amountNum / qtyNum))
        : ''

  function markEdited() {
    editedRef.current = true
  }

  function handleQty(v: string) {
    markEdited()
    onQuantityChange(v)
    // Quando o unitário lidera, o total acompanha a nova quantidade.
    if (mode === 'unit') {
      const u = Number(unitDraft)
      onAmountChange(u > 0 && Number(v) > 0 ? String(round6(Number(v) * u)) : '')
    }
  }

  function handleUnit(v: string) {
    markEdited()
    setMode('unit')
    setUnitDraft(v)
    const u = Number(v)
    onAmountChange(u > 0 && qtyNum > 0 ? String(round6(qtyNum * u)) : '')
  }

  function handleTotal(v: string) {
    markEdited()
    setMode('total')
    onAmountChange(v)
  }

  // Sugestão de preço unitário pelo título + data (debounce). Preenche o unitário
  // enquanto o usuário não tocou em nada (espelha o auto-fill da tela de abertura);
  // o chip permite aplicar/substituir depois. Todo setState fica no callback async
  // (nunca síncrono no corpo do efeito).
  useEffect(() => {
    if (!bondId) return
    let cancelled = false
    const timer = setTimeout(async () => {
      setHintLoading(true)
      const price = await fetchPriceOn(bondId, date || today())
      if (cancelled) return
      setHintLoading(false)
      setHint(price)
      if (price != null && !editedRef.current) {
        setMode('unit')
        setUnitDraft(String(price))
        if (Number(quantity) > 0)
          onAmountChange(String(round6(Number(quantity) * price)))
      }
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // quantity/onAmountChange propositalmente fora das deps: só refazemos a busca
    // quando título ou data mudam (o auto-fill usa o valor corrente via closure).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bondId, date])

  const showChip = hint != null && String(hint) !== unitDisplay

  return (
    <div
      className={`grid grid-cols-1 gap-4 sm:grid-cols-3 ${className ?? ''}`}
    >
      <Field label={quantityLabel} hint={quantityHint}>
        <NumberInput
          value={quantity}
          onChange={handleQty}
          step="0.000001"
          min="0"
          placeholder={quantityPlaceholder}
          required={quantityRequired}
        />
      </Field>

      <Field label="Preço unitário (R$)" hint="Sugestão: cotação do título na data">
        <div className="relative">
          <NumberInput
            value={unitDisplay}
            onChange={handleUnit}
            step="0.01"
            min="0"
            placeholder={unitPlaceholder}
            required={false}
            inputClassName={showChip ? 'pr-[5.5rem]' : undefined}
          />
          {bondId &&
            (hintLoading ? (
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-sage">
                buscando…
              </span>
            ) : showChip ? (
              <button
                type="button"
                onClick={() => handleUnit(String(hint))}
                title={`Cotação na data: ${formatBRL(hint)} · clique para usar`}
                className="nums absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md border border-brass/40 bg-pine/70 px-1.5 py-0.5 text-xs text-brass transition-colors hover:border-brass hover:bg-pine hover:text-brass-bright"
              >
                {formatBRL(hint)}
              </button>
            ) : null)}
        </div>
      </Field>

      <Field label={amountLabel} hint={amountHint}>
        <NumberInput
          value={amount}
          onChange={handleTotal}
          step="0.01"
          min="0"
          placeholder={amountPlaceholder}
          required={amountRequired}
        />
      </Field>
    </div>
  )
}
