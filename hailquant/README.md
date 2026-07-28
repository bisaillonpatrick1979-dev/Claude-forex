# HailQuant

Laboratoire de trading algorithmique — **argent fictif exclusivement**.

> Simulation. Aucun ordre réel n'est transmis. Le mode LIVE est un stub qui lève
> une exception, et le restera jusqu'à la phase 7.

## Démarrer (Termux)

```sh
npm install
npm run dev        # serveur local
npm run test       # tests unitaires
npm run typecheck  # TypeScript strict, zéro any
npm run build      # bundle de production
```

Aucune clé API n'est nécessaire pour démarrer : Binance et Kraken exposent leurs
bougies publiquement. Voir `.env.example` pour les fournisseurs qui en exigent une.

## Architecture

Le moteur reprend le découpage de LEAN (QuantConnect) en cinq modules
interchangeables, chacun défini par une interface avant toute implémentation :

```
Univers → Alpha → Portefeuille → Risque → Exécution
```

### La règle qui prime sur toutes les autres

**Aucun module ne peut lire une bougie future.** Le moteur est événementiel :
les bougies entrent une par une, en ordre chronologique, et `StrategyContext`
ne donne accès qu'aux bougies **closes** jusqu'à l'index courant. Ce n'est pas
une convention à respecter, c'est une impossibilité structurelle — le contexte
ne détient pas la série complète.

Une plateforme qui autorise le look-ahead produit des backtests magnifiques et
des pertes réelles.

### Argent

Aucun montant n'est manipulé en flottant. `lib/decimal.ts` travaille sur des
`bigint` à échelle fixe (8 décimales, soit le satoshi). Toute division exige un
mode d'arrondi explicite : arrondir une taille de position vers le haut ferait
franchir le plafond de risque qu'on vient de calculer.

## Phases

| Phase | Objet | État |
| --- | --- | --- |
| 1 | Fondations : Vite, TS strict, i18n, types, décimal, navigation | ✅ |
| 2 | Données et graphique | à venir |
| 3 | Portefeuille virtuel | à venir |
| 4 | Moteur et cinq modules | à venir |
| 5 | Backtest et validation | à venir |
| 6 | Couche IA | à venir |
| 7 | Brokers, garde-fous, coffre chiffré | à venir |

## Attribution

Graphiques par [TradingView](https://www.tradingview.com/lightweight-charts/)
(lightweight-charts, Apache 2.0). L'attribution reste visible sur le graphique,
comme la licence l'exige.
