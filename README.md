# Trading Floor IA

Une firme de trading simulée. Des agents IA spécialisés analysent des marchés réels
(Forex, indices, actions, crypto), débattent entre eux, prennent des décisions et les
exécutent dans un moteur de portefeuille — la conversation se déroule en direct à côté des
graphiques.

**Résultats simulés. Le trading comporte un risque de perte totale du capital.** Ce projet
ne promet aucun rendement et n'affiche que des résultats mesurés.

## État

Phases 0 (fondations), 1 (données de marché), 2 (graphique), 3 (moteur d'exécution
et garde-fous de risque), 4a (gouvernance des agents), 4b (orchestrateur LLM),
5 (salle des marchés en temps réel) et 6 (backtest chiffré et validation
statistique) livrées. La phase 7 (passerelle courtier réel) reste volontairement
bloquée : rien n'en est codé. Voir
[NOTES.md](./NOTES.md) pour l'avancement détaillé, les décisions d'architecture et les dettes
assumées.

Le mode réel est verrouillé par trois barrières indépendantes (constante TypeScript,
variable d'environnement, triggers PostgreSQL). Aucun code d'ordre réel n'existe dans le
dépôt.

## Qui a le droit de trader

Chaque agent porte un niveau d'autonomie, réglable dans **Agents** :

| Niveau | Ce que l'agent peut faire |
| --- | --- |
| Observateur | analyse et débat, aucune écriture sur le portefeuille |
| Proposition | propose des ordres ; rien ne part sans validation humaine |
| Autonome | fait exécuter ses ordres seul, dans ses limites |

L'autonomie n'est ouverte qu'au trader et au gestionnaire de portefeuille, et un trigger
PostgreSQL la refuse aux autres rôles. À cela s'ajoutent, par agent : droits d'ouverture, de
fermeture et de déplacement de stop, taille maximale, risque maximal par trade, nombre de
trades par jour, périmètre d'instruments, confiance minimale exigée, et un seuil de taille
au-delà duquel même un agent autonome redemande une validation.

Trois garanties valent en permanence : les plafonds du portefeuille s'appliquent toujours (la
limite d'un agent ne peut que resserrer, jamais élargir), le mode d'opération prime sur les
niveaux individuels, et le kill switch coupe tout le monde. Les ordres en attente se traitent
dans **Validation**.

## Stack

Next.js 15 (App Router) · TypeScript strict · Tailwind CSS v4 · Supabase (PostgreSQL,
Realtime, RLS, pgvector) · lightweight-charts v5 · Vitest · déploiement Vercel.

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
src/composants/      composants d'interface, dont le graphique en chandeliers
src/lib/agents/      niveaux d'autonomie, permissions, lecture serveur des agents
src/lib/config/      drapeaux, modes, valeurs par défaut de risque, environnement
src/lib/execution/   moteur simulé, coûts, marge, séances, persistance
src/lib/risque/      garde-fous et estimation de corrélation
src/lib/marche/      interface fournisseur, adaptateurs, routeur, quotas, cache
src/lib/securite/    chiffrement des clés API, limitation de débit
src/lib/supabase/    clients navigateur / serveur / admin / middleware
src/types/           types générés depuis le schéma Supabase
supabase/migrations/ schéma, RLS, amorçage
tests/               tests Vitest
```
