import { createBrowserClient } from '@supabase/ssr';

import { envPublic } from '@/lib/config/env';
import type { Database } from '@/types/base-de-donnees';

/**
 * Client navigateur. `createBrowserClient` est déjà un singleton interne :
 * appeler cette fonction plusieurs fois ne crée pas plusieurs connexions.
 */
export function clientNavigateur() {
  const env = envPublic();
  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
