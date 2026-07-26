# NOTES — Trading Floor IA

Journal d'ingénierie : décisions d'architecture, dettes assumées, pièges rencontrés.
Tenu à jour à chaque phase.

---

## État d'avancement

| Phase | Objet | État |
| --- | --- | --- |
| 0 | Fondations : Next.js 15, Supabase, schéma, RLS, auth, navigation, thème | ✅ livrée |
| 1 | Données de marché : interface, adaptateurs, routeur, quotas, cache, réglages | ✅ livrée |
| 2 | Graphique lightweight-charts v5, indicateurs, mise à jour en direct | ✅ livrée |
| 3 | Moteur d'exécution simulé + garde-fous de risque | ✅ livrée |
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

## Décisions d'architecture (phase 2)

### L'anti-clignotement est une contrainte de conception, pas un réglage

Le graphique n'est créé **qu'une fois**. Les données arrivent ensuite par
`series.update()` sur les bougies de queue — celles dont l'horodatage est au moins égal à
celui de la dernière bougie appliquée, c'est-à-dire la bougie en formation et les nouvelles.
`setData()` n'est appelé qu'au premier chargement et au changement d'instrument, et
`fitContent()` uniquement dans ce cas.

Corollaire côté données : le hook conserve l'état précédent pendant un rechargement. Vider
la série puis la remplir produirait exactement le clignotement qu'on veut éviter. Seul un
changement d'instrument vide la série — garder les bougies du symbole précédent afficherait
des prix qui n'existent pas sur le nouveau.

### Le sondage plutôt qu'un WebSocket

La cadence est calée sur le TTL du cache serveur (M1 : 20 s, H1 : 2 min, D1 : 10 min) :
sonder plus vite ne rapporterait rien de neuf et consommerait du quota fournisseur. Le
sondage s'arrête quand l'onglet passe en arrière-plan.

Un WebSocket (Finnhub en propose un sur son palier gratuit) n'a d'intérêt qu'une fois le
moteur d'exécution en place, quand la latence commencera à compter.

### Une seule implémentation des indicateurs

`lib/marche/indicateurs.ts` sert au graphique **et** au snapshot passé à l'analyste
technique en phase 4. L'agent verra donc exactement les valeurs que j'ai à l'écran — sans
ça, il pourrait « citer le RSI » avec un chiffre que je ne retrouve nulle part.

Règle commune à tous : la sortie a la longueur de l'entrée, et les positions non encore
définies valent `null`, jamais 0. Un RSI à 0 sur ses treize premières bougies se lirait
comme une survente extrême.

L'EMA est amorcée par une moyenne simple sur la première fenêtre, convention des plateformes
de trading : amorcer sur la première valeur seule donnerait une courbe qui ne correspond à
aucun graphique de référence.

### Marqueurs ancrés à la bougie, jamais au prix

`MarqueurDecision` n'accepte que les positions `aboveBar` / `belowBar` / `inBar`. Un stop ou
une cible se représente par une ligne de prix, pas par un marqueur ancré à un prix qui se
perdrait au dézoom. Le graphique sait déjà les afficher avec l'extrait de raisonnement au
survol ; la phase 5 n'aura qu'à les alimenter.

### Un seul identifiant en anglais dans tout le projet

`useChandeliers`. React impose le préfixe `use` pour reconnaître un hook, et son linter
refuse tout autre nom — la convention du framework l'emporte sur celle du projet.

---

## Décisions d'architecture (phase 3)

### Le moteur ne connaît pas la base

`traiterBougie(etat, contexte)` est une fonction pure : elle reçoit un état, rend un nouvel
état, des événements et des écritures. `lib/execution/persistance.ts` est le seul fichier qui
traduit vers Supabase.

C'est ce qui rend vraie la promesse « un seul code, deux sources d'horloge » : le backtest
(phase 6) fera tourner exactement le même moteur en boucle sur l'historique, sans écrire une
ligne en base. Un backtest qui utiliserait un second moteur ne mesurerait pas le système qui
tradera.

### L'ordre des opérations dans une bougie est figé

Expiration → stops et cibles → remplissages → portage → réévaluation → appel de marge.

Les stops passent **avant** les nouveaux remplissages : une position déjà ouverte doit pouvoir
être coupée par la bougie qui, par ailleurs, déclenche une entrée. L'inverse laisserait
survivre des positions qui auraient dû sauter.

### Toutes les ambiguïtés sont tranchées en défaveur du trader

Sans données intra-bougie, plusieurs situations sont indécidables. Chaque fois, on retient
l'hypothèse la plus défavorable — c'est la seule qui produise un backtest utilisable :

- **stop et cible dans la même bougie** → le stop l'emporte ;
- **ouverture au-delà du stop (gap)** → servi au prix d'ouverture, pas au stop. C'est là que
  se logent les pertes supérieures au risque prévu ;
- **ordre stop déclenché** → slippage appliqué, parce que c'est justement le moment où le
  marché va vite ;
- **take-profit** → pas de slippage (c'est un ordre limite), mais le spread s'applique quand
  même ;
- **liquidation sur appel de marge** → la position la plus perdante d'abord, une à la fois,
  avec réévaluation entre chaque.

### La conversion de devise n'est jamais devinée

Un P&L en yens compté comme des dollars, c'est une erreur d'un facteur 150 qui ne déclenche
aucune alerte. `tauxConversion` rend `null` quand il faudrait une cotation tierce (EUR/GBP sur
un compte en dollars), et le moteur refuse alors d'ouvrir plutôt que de compter faux.

### Les plafonds de risque sont des `if`, jamais des prompts

`lib/risque/garde-fous.ts` est une fonction pure, sans accès à la base ni à l'horloge système.
Tout entre par paramètre, donc tout est reproductible et testable. Elle **réduit** la taille
plutôt que de refuser quand c'est possible — refuser systématiquement pousserait à relever les
limites.

Onze contrôles, tous journalisés, y compris ceux qui passent : l'interface montre la raison
exacte d'un refus ou d'une réduction.

### La corrélation est estimée par exposition aux devises

Tant qu'il n'y a pas d'historique de rendements (phase 6), une vraie corrélation est
impossible à calculer. Mais renoncer au plafond en attendant reviendrait à autoriser cinq fois
le même pari sous cinq noms différents.

Acheter EUR/USD, c'est être long EUR et short USD. La similarité cosinus de ces vecteurs
capture les cas qui comptent : EUR/USD et GBP/USD longs sont corrélés, EUR/USD long et
USD/CHF long le sont négativement. Pour les indices, actions et crypto, une valeur par classe.
Heuristique assumée, remplaçable en phase 6.

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

### Un paramètre de slippage qui ne paramétrait rien

Quand l'ATR n'est pas encore calculable, le slippage retombait sur une valeur dérivée du
spread — mais **sans la multiplier par le paramètre**. Régler le slippage à zéro n'avait donc
aucun effet tant qu'aucun ATR n'était disponible, c'est-à-dire sur les premières bougies de
tout backtest. Trouvé par un test qui attendait un prix d'exécution exact.

### Une miette de virgule flottante coûtait 0,5 % de taille à chaque ordre

`1.08 − 1.075` vaut `0.005000000000000004` en binaire. Un plafond théorique de 2 lots
ressortait donc à `1.9999999999999984`, que l'arrondi vers le bas au centième transformait
en **1,99**. Le plancher est indispensable — arrondir vers le haut dépasserait la limite qu'on
vient de calculer — mais il lui fallait une tolérance de 1e-9.

Personne n'aurait remarqué : la taille est plausible, l'ordre passe, et on perd un demi-pour-cent
d'exposition à chaque fois.

### L'axe du RSI montait à 120

Fixer `autoscaleInfoProvider` sur 0–100 ne suffit pas : l'échelle de prix applique ses
propres marges (20 % en haut, 10 % en bas), et l'axe affichait 0 à 120. Les repères 30 et 70
se retrouvaient visuellement décalés vers le bas, ce qui fausse la lecture d'un indicateur
dont tout l'intérêt est la position relative à ces seuils. Corrigé par
`priceScale().applyOptions({ scaleMargins: … })`.

Repéré sur une capture d'écran, pas par un test — certains défauts ne se voient qu'à l'œil.

### `addCandlestickSeries()` n'existe plus en v5

L'API v5 est `chart.addSeries(CandlestickSeries, options, paneIndex)`, avec les définitions
de séries importées comme valeurs (`CandlestickSeries`, `HistogramSeries`, `LineSeries`).
Les marqueurs passent par `createSeriesMarkers(series, markers)` et non plus par
`series.setMarkers()`. Vérifié dans les typages livrés avec la bibliothèque (`typings.d.ts`
de lightweight-charts 5.2.0), pas de mémoire.

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
  pure : moteur d'exécution, garde-fous de risque, indicateurs, routeur de données. Les
  composants d'interface sont vérifiés au navigateur, pas en test unitaire.
- **Pas de calendrier économique branché.** `evaluerGardeFous` sait refuser une ouverture dans
  la fenêtre d'un événement à fort impact, mais la liste d'événements lui est passée vide tant
  que le flux n'existe pas (Finnhub le fournit — phase 4). Le contrôle est en place, sa source
  ne l'est pas encore : c'est signalé ici pour ne pas croire la protection active.
- **`avancerMarche` est déclenché à la main** depuis l'interface. Le passage en cron Vercel
  viendra avec les déclencheurs planifiés de la phase 4.
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
- **Confirmation par courriel désactivée au niveau de la base**, pas du tableau de bord. Le
  réglage « Confirm email » vit dans la configuration GoTrue, hors de portée d'une migration et
  de l'outillage disponible ici. Un trigger `BEFORE INSERT` sur `auth.users` remplit donc
  `email_confirmed_at`, et l'action d'inscription enchaîne sur une connexion immédiate — GoTrue
  ne renvoie pas de session à l'inscription tant que *sa* configuration exige une confirmation,
  même quand l'adresse est confirmée en base.

  Contrepartie assumée : n'importe qui atteignant le déploiement peut créer un compte avec une
  adresse qu'il ne possède pas. Les données restent isolées par RLS, mais chaque compte
  consomme du quota Supabase. À revoir si l'application s'ouvre — Supabase permet de couper les
  inscriptions, ou on peut restreindre à une liste d'adresses par un trigger similaire.

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
conteneur de développement n'autorise les sorties HTTPS que vers une liste blanche très
courte (npm, principalement) ; ni ces deux fournisseurs, ni même l'API Supabase, ne sont
joignables — `CONNECT tunnel failed, 403`. Le chemin réel se vérifie depuis un
`npm run dev` local ou depuis le déploiement, via la sonde de Réglages → Fournisseurs.

## Vérifications faites en fin de phase 2

63 tests, dont 16 nouveaux sur les indicateurs : longueur préservée, `null` avant amorçage,
valeurs exactes de SMA et EMA, RSI borné à 0–100 et sans `NaN` sur série plate, identité
`histogramme = macd − signal`, et prise en compte des gaps par l'ATR.

Vérification visuelle dans Chromium (Playwright), sur une page isolée puisque Supabase est
injoignable depuis ce conteneur — l'appel `/api/marche/chandeliers` était intercepté et servi
avec des bougies déterministes. Ce qui a été constaté :

- graphique rendu, barre d'outils fonctionnelle, aucune erreur console ;
- bascule des quatre indicateurs, changement d'intervalle, actualisation forcée ;
- **3 appels API pour 3 actions** — aucun sondage emballé ;
- tablette 800 × 1280 : aucun débordement horizontal, barre d'outils qui s'enroule.

Non couvert : le comportement sur données réelles et le rendu du fil Realtime (phase 5).
La page de vérification et la modification temporaire du middleware ont été retirées après
coup — rien de cet échafaudage n'est dans le dépôt.

## Vérifications faites en fin de phase 3

118 tests. Les plus importants :

- **anti-look-ahead** (6 tests, fichier dédié) : aucun remplissage sur la bougie de décision
  ni avant, pour les trois types d'ordres ; et un cas où la clôture de la bougie de décision
  était le meilleur prix de la séquence — le moteur ne peut pas y accéder ;
- **grand livre** : sur un scénario de six bougies avec deux entrées, deux sorties sur cible
  et un passage de rollover, la somme des écritures reconstitue le solde final à 1e-8, et
  chaque écriture porte le solde résultant exact ;
- **équité = solde + latent** tant qu'une position est ouverte, et le sommet d'équité ne
  redescend jamais ;
- **conversion de devise** : USD/JPY sur compte en dollars, et refus de compter sans taux ;
- **gap défavorable**, **stop et cible dans la même bougie**, **hors séance**,
  **remplissage partiel**, **expiration**, **appel de marge et liquidation de la plus
  perdante**, **portage facturé une seule fois par rollover** ;
- **garde-fous** : les huit refus francs et les quatre réductions de taille, plus la
  corrélation par exposition aux devises.

Non vérifié : le passage d'ordres depuis l'interface déployée, Supabase étant injoignable
depuis ce conteneur. La logique comptable est en revanche couverte de bout en bout par le
scénario multi-bougies, qui traverse exactement le même code que l'interface.

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
