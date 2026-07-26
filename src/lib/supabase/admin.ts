import { createClient } from '@supabase/supabase-js';

import { envPublic } from '@/lib/config/env';
import { envServeur } from '@/lib/config/env';
import type { Database } from '@/types/base-de-donnees';

/**
 * Client à privilèges : contourne RLS. Réservé aux écritures comptables
 * (moteur d'exécution, orchestrateur, cache de chandeliers) et à la lecture
 * des clés API chiffrées.
 *
 * Règle : tout appel passant par ce client doit filtrer explicitement sur
 * profil_id. RLS ne protège plus ici, c'est au code de le faire.
 */
export function clientAdmin() {
  if (typeof window !== 'undefined') {
    throw new Error('clientAdmin() a été appelée côté navigateur.');
  }

  return createClient<Database>(
    envPublic().NEXT_PUBLIC_SUPABASE_URL,
    envServeur().SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}
