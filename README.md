# Trading Floor IA

Une firme de trading simulée. Des agents IA spécialisés analysent des marchés réels
(Forex, indices, actions, crypto), débattent entre eux, prennent des décisions et les
exécutent dans un moteur de portefeuille — la conversation se déroule en direct à côté des
graphiques.

**Résultats simulés. Le trading comporte un risque de perte totale du capital.** Ce projet
ne promet aucun rendement et n'affiche que des résultats mesurés.

## État

Phase 0 (fondations) livrée. Voir [NOTES.md](./NOTES.md) pour l'avancement détaillé, les
décisions d'architecture et les dettes assumées.

Le mode réel est verrouillé par trois barrières indépendantes (constante TypeScript,
variable d'environnement, triggers PostgreSQL). Aucun code d'ordre réel n'existe dans le
dépôt.

## Stack

Next.js 15 (App Router) · TypeScript strict · Tailwind CSS v4 · Supabase (PostgreSQL,
Realtime, RLS, pgvector) · Vitest · déploiement Vercel.

## Démarrer

```bash
npm install
cp .env.example .env.local   # puis remplir les variables Supabase
npm run dev
```

Les migrations sont dans `supabase/migrations/`, à appliquer dans l'ordre des noms de
fichiers.

## Commandes

| Commande | Effet |
| --- | --- |
| `npm run dev` | serveur de développement |
| `npm run build` | build de production |
| `npm test` | tests Vitest (logique métier) |
| `npm run verif-types` | `tsc --noEmit` |
| `npm run lint` | ESLint |

## Structure

```
src/app/             routes (App Router) ; le groupe (firme) porte les pages authentifiées
src/composants/      composants d'interface
src/lib/config/      drapeaux, modes, valeurs par défaut de risque, environnement
src/lib/supabase/    clients navigateur / serveur / admin / middleware
src/types/           types générés depuis le schéma Supabase
supabase/migrations/ schéma, RLS, amorçage
tests/               tests Vitest
```
