// Ponto único de import dos serviços de banco:
//   import { supabase } from '@/services/supabase'
//   import type { Tables, UserRole } from '@/services/supabase'
export { supabase } from './client'

export type {
  Database,
  Json,
  Tables,
  TablesInsert,
  TablesUpdate,
} from './database.types'

import type { Database } from './database.types'

// Aliases de conveniência para os enums do banco (derivados dos tipos gerados).
type Enums = Database['public']['Enums']
export type UserRole = Enums['user_role']
export type ObligationStatus = Enums['obligation_status']
export type TransactionType = Enums['transaction_type']
export type TransactionStatus = Enums['transaction_status']
