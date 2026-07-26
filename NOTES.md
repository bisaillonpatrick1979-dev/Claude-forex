# NOTES — Trading Floor IA

Journal d'ingénierie : décisions d'architecture, dettes assumées, pièges rencontrés.
Tenu à jour à chaque phase.

---

## État d'avancement

| Phase | Objet | État |
| --- | --- | --- |
| 0 | Fondations : Next.js 15, Supabase, schéma, RLS, auth, navigation, thème | ✅ livrée |
| 1 | Données de marché : interface, adaptateurs, routeur, quotas, cache, réglages | ✅ livrée |
| 2 | Graphique lightweight-charts v5 | à faire |
| 3 | Moteur d'exécution simulé + garde-fous de risque | à faire |
| 4 | Agents et orchestration | à faire |
| 5 | Salle des marchés en temps réel | à faire |
| 6 | Backtest, mémoire pgvector, coûts | à faire |
| 7 | Passerelle broker réel — **à discuter, rien de codé** | bloquée volontairement |

---

## Décisions d'architecture (phase 0)

### Trois verrous indépendants sur le mode réel

Le cahier des charges demande qu'aucune ligne de code ne puisse envoyer un ordre réel
avant la phase 7. Un seul `if` est une garantie faible. Il y a donc trois barrières,
à lever ensemble :

1. `VERROU_PHASE_7` — constante en dur dans `src/lib/config/drapeaux.ts`, qui court-circuite
   la lecture de l'environnement ;
2. `AUTORISER_MODE_REEL` — variable d'environnement serveur, à `false` ;
3. deux triggers PostgreSQL (`profils_verrou_mode_reel`, `portefeuilles_verrou_mode_reel`)
   qui refusent toute valeur commençant par `REEL`.

Le troisième est le seul qui compte vraiment : la policy RLS autorise le propriétaire à
modifier son profil depuis le navigateur, donc un contrôle purement applicatif serait
contournable avec la clé publiable et un client Supabase. Testé
(`tests/drapeaux.test.ts` + vérification SQL directe).

### Deux postures RLS, pas une

- **Tables de configuration** (`profils`, `agents`, `mandats_agents`, `parametres_risque`,
  `fournisseurs_donnees`) : lecture et écriture par le propriétaire depuis le navigateur.
- **Tables comptables et production des agents** (`portefeuilles`, `ordres`, `positions`,
  `transactions`, `cycles`, `messages_agents`…) : **lecture seule** côté navigateur. Toute
  écriture passe par du code serveur (`service_role`) ou par une fonction `SECURITY DEFINER`
  étroite. Un grand livre modifiable depuis le navigateur ne vaut rien.

`cles_api` n'a **aucune** policy : RLS activée sans policy = invisible pour `anon` et
`authenticated`, accessible seulement à `service_role`. Le linter Supabase le signale en
INFO ; c'est l'effet recherché, pas un oubli.

### Le kill switch passe par une fonction en base, pas par la clé service_role

`declencher_kill_switch()` est `SECURITY DEFINER`, sans paramètre libre autre qu'une raison
textuelle, et n'agit que sur les lignes de `auth.uid()`. Avantages sur un appel
`service_role` depuis une Server Action : pas de secret supplémentaire dans le chemin,
opération atomique, et journalisation dans `journal_audit` impossible à contourner.
Le linter la signale (fonction `SECURITY DEFINER` appelable par un utilisateur connecté) —
c'est délibéré et documenté ici.

Le dégel (`lever_kill_switch`) est une action séparée qui **ne réactive pas les agents** :
après un arrêt d'urgence, rien ne redémarre tout seul.

### `profil_id` dénormalisé partout

Presque toutes les tables portent un `profil_id`, même quand il est déductible par jointure
(`decisions_risque` → `propositions_ordres` → `profil_id`). C'est de la dénormalisation
assumée : les policies RLS deviennent `profil_id = auth.uid()`, évaluables sur index, au lieu
de sous-requêtes récursives coûteuses et difficiles à auditer.

### Numériques

Tous les prix, quantités et montants sont en `numeric(20,8)`, jamais en `double precision`.
Le `numeric` PostgreSQL revient en **chaîne** dans le client JS pour les grandes précisions :
`versNombre()` (`src/lib/format.ts`) fait la conversion et renvoie `null` plutôt que `0`
quand la valeur est absente.

### Pas de `next/font`

Polices système (`ui-sans-serif`, `ui-monospace`) plutôt que Geist ou Inter via
`next/font/google` : pas d'appel réseau au build, pas de décalage de rendu, un fichier de
moins à charger. Les chiffres passent par la classe `.chiffre` (chasse fixe + chiffres
tabulaires) pour que les colonnes de prix restent alignées quand les valeurs changent.

### Vert et rouge réservés

`--color-hausse` et `--color-baisse` ne servent qu'au P&L, aux vetos du gestionnaire de
risque et au kill switch. Aucun autre élément d'interface n'y a droit — c'est ce qui rend un
chiffre négatif lisible d'un coup d'œil dans un écran dense.

---

## Décisions d'architecture (phase 1)

### La cascade ne saute jamais une étape en silence

Ordre imposé par `lib/marche/routeur.ts` : cache frais → fournisseurs par priorité →
cache périmé **marqué comme tel** → erreur explicite listant chaque tentative et sa raison.

`ResultatMarche` porte toujours `origine`, `fournisseur`, `perime`, `retarde` et la liste
des `incidents`. L'appelant ne peut pas confondre une bougie fraîche de Twelve Data avec
une bougie de trois heures ressortie du cache. C'est ce qui permettra aux agents (phase 4)
de refuser de trader sur des données périmées.

### Un fournisseur est écarté avant tout appel réseau

Six conditions, vérifiées dans cet ordre, sans consommer un seul appel : adaptateur livré,
priorité définie pour la classe d'actifs, correspondance de symbole en base, classe
couverte, intervalle publié, quota non épuisé, clé présente si requise.

Cas concret couvert par un test : Yahoo ne publie pas d'intervalle 4 heures. Demander du H4
l'écarte avec l'incident « Intervalle H4 non publié » au lieu d'émettre une requête vouée à
échouer.

### Aucun adaptateur ne devine un symbole

La table `correspondances_symboles` est la seule autorité. Deviner « EURUSD » → « EUR/USD »
marche pour le Forex et casse immédiatement sur les indices : NAS100 vaut `^NDX` chez Yahoo
et `NDX` chez Twelve Data. Sans correspondance, le fournisseur est déclaré incapable.

### Le mock est déterministe, et c'est une contrainte, pas un détail

La série n'est pas une marche aléatoire — qui dépendrait du point de départ, donc de la
fenêtre demandée. C'est un bruit de valeur lissé évalué à l'**index absolu** de la bougie.
Conséquence testée : demander 10 bougies ou 200 donne exactement les mêmes valeurs sur la
plage commune. Sans ça, le cache se contredirait et un backtest ne serait pas reproductible.

### Deux compteurs distincts, pour deux problèmes distincts

- `lib/marche/quotas.ts` : compteur **persisté en base**, par fournisseur et par profil,
  aligné sur des bornes naturelles (minute pleine, minuit UTC, premier du mois) — c'est ainsi
  que les fournisseurs comptent. C'est le vrai garde-fou contre l'épuisement d'un palier
  gratuit.
- `lib/securite/limitation-debit.ts` : limitation de débit **en mémoire** sur les Route
  Handlers. Protège d'une boucle de rendu accidentelle, pas d'un attaquant. Voir les dettes.

Le compteur de quota n'est pas atomique : deux appels simultanés peuvent n'en compter qu'un.
Accepté — il sert à éviter le mur, pas à facturer.

### Chiffrement des clés API

AES-256-GCM, clé maîtresse dans `CLE_CHIFFREMENT` (32 octets base64), jamais en base :
compromettre la base ne suffit pas à lire les clés. GCM est authentifié, donc une valeur
altérée est **rejetée** au lieu de produire une clé silencieusement fausse — testé.

Format stocké : `v1.<iv>.<tag>.<chiffré>`, le préfixe de version prépare une rotation
d'algorithme sans avoir à deviner.

### Un écran de diagnostic plutôt qu'une 500

Sans variables Supabase, l'application affichait une erreur 500 opaque sur toutes les pages.
Le middleware laisse maintenant passer quand la configuration manque, et les points d'entrée
rendent `ConfigurationManquante`, qui nomme les variables absentes et rappelle que les
`NEXT_PUBLIC_*` sont intégrées au build (un redéploiement est nécessaire, pas un simple
redémarrage).

### La sonde de Réglages → Fournisseurs

Le graphique n'arrive qu'en phase 2. Sans un écran capable de déclencher une récupération et
d'afficher brut le fournisseur retenu, l'origine, la fraîcheur et chaque tentative échouée,
le critère d'acceptation de la phase 1 serait invérifiable. La sonde n'est pas un gadget de
démonstration : c'est l'instrument de contrôle de la couche de données.

---

## Pièges rencontrés

### Le journal d'audit immuable bloquait la suppression d'un compte

`journal_audit.profil_id` avait une clé étrangère `on delete set null`. Supprimer un
utilisateur déclenchait un `UPDATE` sur `journal_audit`, donc le trigger d'immuabilité, donc
une exception : **suppression de compte impossible**. Découvert en testant réellement la
suppression, pas en relisant le SQL.

Correction (migration `20260726121000`) : la clé étrangère est retirée, `profil_id` reste un
`uuid` simple. Un journal d'audit doit survivre à la disparition de ce qu'il décrit — c'est
le comportement correct, pas un contournement.

Conséquence assumée : les deux lignes d'audit produites par le test de vérification de la
phase 0 sont dans le journal pour toujours (`profil_id` d'un compte supprimé). Elles sont
invisibles pour tout utilisateur réel, puisque la policy filtre sur `auth.uid()`. Les purger
aurait voulu dire désactiver le trigger d'immuabilité, ce qui aurait vidé la garantie de son
sens.

### Les semaines commençaient un jeudi

`floor(instant / 604800) * 604800` aligne les bougies hebdomadaires sur… le jeudi, parce que
le 1er janvier 1970 était un jeudi. Toutes les bougies W1 auraient été décalées de trois
jours, silencieusement. Corrigé par un décalage de 3 jours (le premier lundi de l'époque est
le 5 janvier 1970), et verrouillé par un test qui vérifie que la borne tombe bien un lundi.

Trouvé par le test, pas à la relecture — c'est exactement le genre d'erreur qu'on ne voit
jamais dans un graphique.

### Twelve Data renvoie ses erreurs en HTTP 200

Un `{"status":"error","code":429}` arrive avec un code HTTP 200. Se fier au code HTTP seul
aurait produit une exception de parsing plus loin, au lieu d'un basculement propre sur le
fournisseur suivant. L'adaptateur inspecte donc systématiquement `status` dans le corps.

Autre piège du même adaptateur : `datetime` est rendu dans le fuseau de la place par défaut.
On force `timezone=UTC` — sinon la normalisation est fausse d'un décalage horaire, ce qui ne
se voit pas non plus à l'œil nu.

### Yahoo exige un User-Agent de navigateur

Sans en-tête `User-Agent` ressemblant à un navigateur, les endpoints répondent 403. Ils
raisonnent aussi en **plage** (`range=5d`) et non en nombre de bougies : l'adaptateur choisit
le plus petit palier couvrant la demande, puis tronque.

Les trous (`null`) des périodes sans échange sont **sautés**, jamais comblés : une bougie
inventée est pire qu'une bougie absente.

### La documentation Supabase parle de `proxy.ts`, pas de `middleware.ts`

La doc officielle est passée à la nomenclature Next.js 16 (`proxy.ts`). En Next.js 15 le
fichier s'appelle toujours `middleware.ts`. Le contenu (gestion des cookies `getAll`/`setAll`,
`getClaims()`) est identique.

Deux règles à ne pas oublier dans `src/lib/supabase/middleware.ts` :
- **rien** entre `createServerClient` et `getClaims()` — une opération asynchrone intercalée
  provoque des déconnexions aléatoires très pénibles à diagnostiquer ;
- toujours renvoyer l'objet `NextResponse` produit par `setAll`, sinon les cookies du
  navigateur et ceux du serveur divergent et la session saute.

`getClaims()` et non `getSession()` : `getClaims()` vérifie la signature du JWT à chaque
appel, `getSession()` fait confiance à un cookie falsifiable.

### `create-next-app` et Tailwind v4

Le scaffold installe Tailwind **v4**, configuré en CSS (`@theme` dans `globals.css`), sans
`tailwind.config.ts`. Les tokens du thème sont donc dans `src/app/globals.css`.

---

## Dettes techniques assumées

- **`.env.local` du dépôt local** contient l'URL et la clé publiable Supabase (toutes deux
  publiques par nature). La clé `service_role` n'est **pas** présente : elle devra être
  ajoutée pour la phase 1 (cache de chandeliers écrit côté serveur) et sur Vercel.
- **Aucun test de composant.** Vitest tourne en environnement `node` sur la logique métier
  pure. Les tests qui comptent — moteur de risque, moteur d'exécution, anti-look-ahead —
  arrivent en phase 3, et c'est là qu'ils seront exigés.
- **Index IVFFlat sur `lecons.embedding`** avec `lists = 100` : sous-optimal tant qu'il y a
  peu de leçons, mais bien moins gourmand en mémoire que HNSW sur le palier gratuit. À
  revoir si le volume dépasse quelques milliers de lignes.
- **Dimension d'embedding figée à 1536** (compatible `text-embedding-3-small`). Changer de
  modèle d'embedding imposera une migration de colonne et un recalcul complet.
- **Limitation de débit en mémoire, par instance.** Sur Vercel, chaque instance serverless a
  son propre compteur : le plafond réel est « 60/min par instance », pas « 60/min au total ».
  C'est une protection contre une boucle d'appels accidentelle, pas contre un attaquant
  distribué. Un vrai compteur partagé demande Redis (Upstash, palier payant) ou une écriture
  Postgres par requête (quota de la base gratuite). À revoir si le projet s'ouvre à d'autres
  utilisateurs.
- **Adaptateurs Finnhub, Alpha Vantage et Alpaca non livrés.** Ils existent en base et dans
  l'UI des Réglages, marqués « non livré », et le routeur les ignore explicitement plutôt que
  de faire comme s'ils fonctionnaient. Livrables en phase 1bis si le besoin se confirme
  (Finnhub surtout, pour les news de l'analyste sentiment en phase 4).
- **Pas de WebSocket.** La mise à jour en direct de la phase 2 se fera par sondage du cache,
  pas par flux temps réel. Finnhub en offre un sur son palier gratuit ; ça ne vaut le coût
  qu'une fois le graphique en place.
- **La confirmation par courriel est active** sur le projet Supabase. À l'inscription, la
  firme est créée immédiatement par le trigger, mais la session n'arrive qu'après le clic sur
  le lien reçu. Pour développer sans cette étape : Supabase → Authentication → Sign In / Up →
  désactiver « Confirm email ».

---

## Vérifications faites en fin de phase 0

Exécutées directement sur la base, avec un compte jetable ensuite supprimé :

- inscription → 1 profil, 1 portefeuille, 12 agents, 12 mandats v1, 6 fournisseurs,
  1 jeu de paramètres de risque, 1 ligne d'audit ;
- `update profils set mode_operation = 'REEL_VALIDATION'` → **refusé** par le trigger ;
- `declencher_kill_switch()` → portefeuille gelé, 12 agents désactivés, ligne d'audit écrite ;
- `update journal_audit` → **refusé** ;
- suppression du compte → profil, agents et portefeuille supprimés en cascade, journal
  d'audit conservé, référentiel des symboles intact.

`npm run build` ✅ · `npm test` (9 tests) ✅ · `npx eslint .` ✅ · `npx tsc --noEmit` ✅

## Vérifications faites en fin de phase 1

- 47 tests au total, dont la cascade complète du routeur sur un faux client Supabase :
  cache frais servi sans appel réseau, quota épuisé écarté sans appel, clé absente écartée
  sans appel, intervalle non publié écarté, symbole sans correspondance écarté, erreur 429
  d'un fournisseur prioritaire qui bascule sur le suivant, cache périmé servi et marqué,
  erreur explicite quand il ne reste rien ;
- déterminisme du mock vérifié sur trois axes (fenêtre, moment de l'appel, symbole) ;
- alignement des bougies, y compris le cas W1 ;
- chiffrement : aller-retour, IV aléatoire, rejet d'une valeur altérée, rejet d'un format
  inconnu ;
- serveur lancé : `/connexion` répond 200, `/salle-des-marches` redirige en 307 vers
  `/connexion`, `/api/marche/chandeliers` répond 401 sans session.

**Non vérifié depuis cet environnement** : les appels réels à Yahoo et Twelve Data. Le
conteneur de développement n'autorise les sorties HTTPS que vers une liste blanche
(npm, Supabase…), et ces deux domaines en sont absents — `CONNECT tunnel failed, 403`. Le
chemin réel se vérifie depuis un `npm run dev` local ou depuis le déploiement, via la sonde
de Réglages → Fournisseurs.

---

## Régénérer les types

Les types de `src/types/base-de-donnees.ts` sont générés depuis le schéma déployé.

```bash
npx supabase gen types typescript --project-id pnpdftlehrzwqltdokyo > src/types/base-de-donnees.ts
```

Nécessite `SUPABASE_ACCESS_TOKEN` (Supabase → Account → Access Tokens). Réajouter à la main
l'en-tête « ne pas modifier » en haut du fichier.

---

## Ce qui reste à décider

- **Fournisseur de données prioritaire pour les indices.** Twelve Data expose `NDX` sur le
  palier gratuit mais en données retardées ; Yahoo donne `^NDX` sans clé mais sans aucune
  garantie de disponibilité. À trancher en phase 1, une fois les quotas réels mesurés.
- **Modèle d'embedding.** Voir la dimension figée à 1536 ci-dessus.
- **Phase 7 / broker réel.** Alberta : OANDA est hors jeu, Interactive Brokers Canada est la
  voie viable, Alpaca couvre le papier actions/indices US. L'architecture prévoit un
  adaptateur broker, mais rien n'est écrit et rien ne le sera sans discussion préalable.
