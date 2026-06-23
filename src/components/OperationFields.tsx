import type { ReactNode } from 'react'
import { DateInput, Field, NumberInput, Select, Textarea } from '@/components/ui'
import { TreasuryAmountInput } from '@/components/TreasuryAmountInput'
import { formatBRL } from '@/lib/format'
import {
  KIND_LABELS,
  bondLabel,
  effectiveReposition,
  type BondOption,
  type OperationKind,
  type OperationValues,
} from '@/lib/operations'

// Rótulos/lado da cotação derivados do tipo de operação.
function defaultsFor(kind: OperationKind) {
  if (kind === 'APORTE') {
    return {
      priceSide: 'buy' as const,
      quantityLabel: 'Quantidade de títulos',
      quantityHint: 'Unidades do título compradas',
      amountLabel: 'Valor total aportado (R$)',
      amountHint: 'Total pago no aporte',
    }
  }
  return {
    priceSide: 'sell' as const,
    quantityLabel: 'Quantidade de títulos',
    quantityHint: 'Unidades efetivamente liquidadas',
    amountLabel: 'Valor bruto (R$)',
    amountHint: 'Total retirado, antes do IR',
  }
}

// Bloco de campos compartilhado por aporte e saída (resgate/despesa). Apresentacional:
// NÃO chama RPC nem carrega dados — recebe tudo por props e emite mudanças via
// onChange. O pai detém o estado (`values`) e decide o submit (RPC instantânea nas
// páginas, change empilhado no rascunho do histórico).
export function OperationFields({
  kind,
  kinds,
  onKindChange,
  bonds,
  values,
  onChange,
  repaymentOutstanding = 0,
  monthlyExpected = 1000,
  maxDate,
  dateLabel = 'Data do lançamento',
  dateHint,
  belowType,
  purchasableOnly = true,
}: {
  kind: OperationKind
  // Opções do seletor de tipo. Quando há >1, o seletor é renderizado; senão o tipo é
  // fixo (ex.: card de aporte, edição com tipo travado).
  kinds: OperationKind[]
  onKindChange?: (k: OperationKind) => void
  bonds: BondOption[]
  values: OperationValues
  onChange: (patch: Partial<OperationValues>) => void
  // Saldo de resgate a repor do cotista (>0 → mostra a divisão no APORTE).
  repaymentOutstanding?: number
  monthlyExpected?: number
  maxDate?: string
  dateLabel?: string
  dateHint?: string
  // Slot opcional logo após o seletor de tipo (ex.: seletor de cotista no modal de
  // criação, quando o admin lança em nome de outro).
  belowType?: ReactNode
  // Restringe o APORTE a títulos compráveis. Edição passa false para não esconder o
  // título de um aporte antigo cujo título saiu de venda.
  purchasableOnly?: boolean
}) {
  const d = defaultsFor(kind)
  const showTypeSelector = kinds.length > 1 && !!onKindChange

  // Aporte só aceita títulos compráveis; saídas, qualquer um. Filtro tolerante: sem o
  // flag (lista já filtrada pelo pai) mantém tudo.
  const bondOptions =
    kind === 'APORTE' && purchasableOnly
      ? bonds.filter((b) => b.is_available_for_purchase !== false)
      : bonds

  const amountNum = Number(values.amount)
  const showSplit = kind === 'APORTE' && repaymentOutstanding > 0 && amountNum > 0
  const repoNum = effectiveReposition(
    amountNum,
    values.repositionAmount,
    repaymentOutstanding,
    monthlyExpected,
  )
  const obligationPart = amountNum > 0 ? Math.max(amountNum - repoNum, 0) : 0

  return (
    <>
      {showTypeSelector && (
        <Field label="Tipo de lançamento">
          <Select
            value={kind}
            onChange={(v) => onKindChange?.(v as OperationKind)}
          >
            {kinds.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {belowType}

      <Field label="Título">
        <Select
          value={values.bondId}
          onChange={(v) => onChange({ bondId: v })}
          required
          disabled={bondOptions.length === 0}
        >
          <option value="" disabled>
            {bondOptions.length === 0
              ? 'Nenhum título disponível'
              : 'Selecione um título'}
          </option>
          {bondOptions.map((b) => (
            <option key={b.id} value={b.id}>
              {bondLabel(b)}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={dateLabel} hint={dateHint}>
        <DateInput
          value={values.eventDate}
          onChange={(v) => onChange({ eventDate: v })}
          max={maxDate}
          required={false}
        />
      </Field>

      <TreasuryAmountInput
        bondId={values.bondId}
        date={values.eventDate}
        priceSide={d.priceSide}
        quantity={values.quantity}
        amount={values.amount}
        onQuantityChange={(v) => onChange({ quantity: v })}
        onAmountChange={(v) => onChange({ amount: v })}
        quantityLabel={d.quantityLabel}
        quantityHint={d.quantityHint}
        amountLabel={d.amountLabel}
        amountHint={d.amountHint}
      />

      {showSplit && (
        <div className="flex flex-col gap-3 rounded-lg border border-brass/30 bg-pine/40 p-4">
          <div className="flex items-baseline justify-between">
            <span className="eyebrow text-sage">Divisão do aporte</span>
            <span className="text-xs text-bone-dim">
              Resgate a repor: {formatBRL(repaymentOutstanding)}
            </span>
          </div>
          <Field
            label="Destinado à reposição de resgate (R$)"
            hint="Esta parte abate o resgate pessoal e NÃO conta como mensalidade. Sugestão: cobrir 1 mensalidade e repor o excedente."
          >
            <NumberInput
              value={
                values.repositionAmount === ''
                  ? String(repoNum)
                  : values.repositionAmount
              }
              onChange={(v) => onChange({ repositionAmount: v })}
              step="0.01"
              min="0"
              placeholder="0,00"
              required={false}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border border-line bg-raised/60 px-3 py-2">
              <span className="eyebrow text-sage">Obrigação mensal</span>
              <p className="nums mt-0.5 font-semibold text-bone">
                {formatBRL(obligationPart)}
              </p>
            </div>
            <div className="rounded-lg border border-line bg-raised/60 px-3 py-2">
              <span className="eyebrow text-sage">Reposição</span>
              <p className="nums mt-0.5 font-semibold text-brass">
                {formatBRL(repoNum)}
              </p>
            </div>
          </div>
        </div>
      )}

      <Field label="Nota (opcional)" hint="Observação livre sobre este lançamento.">
        <Textarea
          value={values.note}
          onChange={(v) => onChange({ note: v })}
          placeholder="Observação livre"
        />
      </Field>
    </>
  )
}
