import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createUser, one, pool, resetDb, supabase } from './helpers/db'

// resetDb não trunca fund_settings (o seed da migração persiste); forçamos NOMINAL
// no início de cada teste para um ponto de partida determinístico.
beforeEach(async () => {
  await resetDb()
  await pool.query(`UPDATE fund_settings SET debt_mode='NOMINAL' WHERE id=1`)
})
afterAll(async () => {
  await pool.end()
})

async function debtMode(): Promise<string> {
  const row = await one<{ debt_mode: string }>(
    `SELECT debt_mode FROM fund_settings WHERE id=1`,
  )
  return row.debt_mode
}

describe('Política de dívida de resgate (set_debt_mode)', () => {
  it('default é NOMINAL', async () => {
    expect(await debtMode()).toBe('NOMINAL')
  })

  it('admin alterna para PARTICIPACAO e volta para NOMINAL', async () => {
    const admin = await createUser('Admin', 'ADMIN')

    const { error: e1 } = await supabase.rpc('set_debt_mode', {
      p_admin_id: admin,
      p_mode: 'PARTICIPACAO',
    })
    expect(e1).toBeNull()
    expect(await debtMode()).toBe('PARTICIPACAO')

    const { error: e2 } = await supabase.rpc('set_debt_mode', {
      p_admin_id: admin,
      p_mode: 'NOMINAL',
    })
    expect(e2).toBeNull()
    expect(await debtMode()).toBe('NOMINAL')
  })

  it('modo inválido é rejeitado', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const { error } = await supabase.rpc('set_debt_mode', {
      p_admin_id: admin,
      p_mode: 'OUTRO',
    })
    expect(error).not.toBeNull()
    expect(await debtMode()).toBe('NOMINAL')
  })

  it('cotista comum não pode trocar (gate admin)', async () => {
    const joao = await createUser('Joao')
    const { error } = await supabase.rpc('set_debt_mode', {
      p_admin_id: joao,
      p_mode: 'PARTICIPACAO',
    })
    expect(error).not.toBeNull()
    expect(await debtMode()).toBe('NOMINAL')
  })
})
