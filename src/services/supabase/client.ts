import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Variáveis de ambiente do Supabase ausentes. Defina VITE_SUPABASE_URL e ' +
      'VITE_SUPABASE_ANON_KEY no arquivo .env (veja .env.example).',
  )
}

// Cliente único e tipado para todo o app. Importe daqui:
//   import { supabase } from '@/services/supabase/client'
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey)
