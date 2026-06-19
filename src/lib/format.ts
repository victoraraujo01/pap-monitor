// Formatação pt-BR compartilhada pelas views.

const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

// R$ 1.234,56
export function formatBRL(value: number | null | undefined): string {
  return brl.format(value ?? 0)
}

// Cotas com até 6 casas (a convenção do banco usa NUMERIC(15,6)).
export function formatQuotas(value: number | null | undefined): string {
  return (value ?? 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  })
}

// 19/06/2026 a partir de 'YYYY-MM-DD' ou ISO timestamp, sem cair em fuso (datas
// puras são tratadas como locais para não voltar um dia).
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const datePart = value.slice(0, 10)
  const [y, m, d] = datePart.split('-')
  if (y && m && d) return `${d}/${m}/${y}`
  return value
}
