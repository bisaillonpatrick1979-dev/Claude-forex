import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // Les tests portent sur la logique métier pure (risque, exécution,
    // formatage). Aucun test de composant ici : ils sont lents et fragiles,
    // et ce n'est pas là que se cachent les erreurs qui coûtent de l'argent.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
