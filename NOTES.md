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
| 4a | Gouvernance des agents : permissions, autonomie, file de validation | ✅ livrée |
| 4b | Orchestrateur : cycles LLM, débat, mémoire, enveloppe de capital, rejeu | ✅ livrée |
| 5 | Salle des marchés en temps réel : fil des spécialistes, marqueurs de décision | ✅ livrée |
| 6 | Backtest chiffré et comparateurs (buy-and-hold, stratégie aléatoire) | à faire |
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

## Décisions d'architecture (phase 4a)

### Deux barrières, jamais confondues

`permissions_agents` répond à « cet agent-là a-t-il le droit d'agir, et faut-il un humain ? ».
`parametres_risque` répond à « quelle taille le portefeuille supporte-t-il ? ». Les deux sont
évaluées dans cet ordre, par deux fonctions pures distinctes (`evaluerPermission` puis
`evaluerGardeFous`), et aucune ne connaît le domaine de l'autre.

La tentation était de tout mettre dans les garde-fous, avec un champ « agent autorisé » de
plus. Ç'aurait mélangé deux questions dont les réponses changent à des rythmes différents :
les droits se règlent une fois et se relisent souvent, les plafonds de risque se recalculent à
chaque ordre. Séparées, chacune se teste isolément — 28 tests pour les permissions, sans
jamais construire un portefeuille.

Corollaire : un agent autonome reste soumis aux garde-fous, et un agent bridé par les
garde-fous n'obtient pas l'autonomie pour autant.

### Le plus strict des deux gagne, toujours

`fusionnerRisque` prend le minimum entre le plafond de risque du portefeuille et celui de
l'agent. Une permission ne peut donc jamais élargir une limite, seulement la resserrer.

C'est indispensable, pas cosmétique : la policy RLS autorise le propriétaire à écrire
`permissions_agents` depuis le navigateur. Sans cette règle, il aurait suffi d'un `risque max
par trade` d'agent à 10 % pour contourner un plafond de portefeuille à 1 % — la table des
permissions serait devenue la porte de sortie des garde-fous.

### Le niveau d'autonomie est fermé par défaut

À la création de la firme, personne n'est autonome : les dix rôles d'analyse et de recherche
naissent `OBSERVATEUR`, le trader et le gestionnaire de portefeuille naissent `PROPOSITION`.
Ouvrir un droit est un geste explicite de l'utilisateur, jamais un défaut hérité.

Les permissions naissent d'un trigger sur l'insertion d'un agent, pas dans
`initialiser_profil()` : un agent créé plus tard, par l'UI ou par une migration, obtient ses
droits par défaut sans qu'on ait à y penser. Aucun agent ne peut exister sans ligne de
permission — et si une ligne manquait malgré tout, `PERMISSION_FERMEE` s'applique côté
serveur : pas de ligne, pas de droits.

### L'autonomie est refusée aux rôles non exécutants, en base

Seuls `TRADER` et `GESTIONNAIRE_PORTEFEUILLE` peuvent passer `AUTONOME`. Un trigger
PostgreSQL le refuse pour les autres rôles, et l'UI grise le bouton avec l'explication.

Le doublon est volontaire : l'UI est ergonomique, le trigger est la garantie. Comme pour le
mode réel, un contrôle applicatif seul serait contournable — la table est écrite depuis le
navigateur.

Et si une ligne `AUTONOME` échappait quand même au trigger, `evaluerPermission` la rétrograde
en validation humaine au lieu d'exécuter. Trois niveaux de refus pour la même règle.

### Le mode du profil prime sur le niveau de l'agent

`PAPIER_VALIDATION` impose la validation à tous, même aux agents autonomes.
`PAPIER_CONSEIL` va plus loin : il refuse la soumission au lieu de la mettre en file, parce
qu'une proposition en attente laisserait croire qu'elle est exécutable alors que le mode dit
l'inverse — les agents conseillent, l'humain trade.

### La validation lève l'exigence d'un humain, pas les droits

Approuver une proposition rejoue les deux barrières. Un agent suspendu ou désactivé
entre-temps reste bloqué : il faut le réactiver explicitement. Et surtout, le contrôle de
risque est refait sur le prix du moment — approuver quinze minutes plus tard une taille
calculée sur des prix périmés reviendrait à exécuter une décision qui n'a plus de sens.

C'est aussi pour ça qu'une proposition porte une date d'expiration (30 minutes par défaut,
réglable par agent) et que la file archive les périmées avant de s'afficher.

### Chaque décision laisse une ligne, y compris les refus

Une proposition refusée par les permissions est écrite avec le statut `REFUSEE_PERMISSION`,
distinct de `REJETEE_RISQUE`. Sans cette distinction, un agent recalé faute de droits
apparaîtrait comme « rejeté par le risque », ce qui est faux et rend l'historique inutilisable
pour comprendre pourquoi un agent n'a rien fait de la journée.

### Le quota quotidien ne bloque jamais une fermeture

`trades_max_par_jour` ne compte que les ouvertures. Interdire une fermeture parce que le quota
est atteint laisserait une position ouverte sans personne pour la refermer : la limite
protégerait du sur-trading en créant un risque plus grand.

Même logique pour la confiance minimale, qui ne s'applique qu'aux ouvertures.

### Le banc d'essai emprunte le vrai chemin

L'orchestrateur n'existe pas encore, mais `soumettreProposition` est complet. La page Agents
l'appelle telle quelle : mêmes barrières, mêmes écritures, mêmes traces. Ce qui est testé à la
main aujourd'hui est exactement ce qui tournera en automatique en phase 4b — l'orchestrateur
n'aura pas de chemin d'exécution à lui.

---

## Décisions d'architecture (phase 4b)

### Quatre fournisseurs de modèles derrière un contrat unique

`lib/ia/types.ts` définit `AdaptateurLLM`, implémenté par Anthropic (SDK
officiel), OpenAI, Google et `mock`. Aucun étage de l'application ne nomme un
fournisseur : le choix se fait agent par agent, en base.

Le défaut reste `mock` / `mock-1`. Un cycle complet — analyse, débat, synthèse,
proposition, contrôle de risque, décision — tourne donc de bout en bout sans
qu'aucune clé n'ait été saisie et sans dépenser un cent. C'est ce qui permet de
voir la mécanique avant de décider de la payer. La sortie du mock est
déterministe et **ancrée sur l'instantané réel** : il ne peut pas inventer un
prix, exactement comme on l'exige d'un vrai agent.

### `temperature` est refusé par les modèles Anthropic récents

Opus 5, Sonnet 5 et Opus 4.7+ répondent **400** quand `temperature` est
présent. Ce n'est pas un avertissement : l'appel échoue. La colonne
`agents.temperature` reste utile pour OpenAI et Google, donc c'est
`accepteTemperature()` qui décide de la transmettre — liste blanche et non
liste noire : un modèle inconnu ne reçoit pas de température.

Gemini a le piège symétrique : il répond 200 avec un candidat vide quand un
filtre de sécurité a bloqué la génération. Le silence serait pris pour une
réponse valide ; l'adaptateur en fait une erreur.

### Deux méthodes d'embedding, jamais mélangées

`openai-3-small` est sémantique et exige une clé OpenAI. `lexical-1536` est une
projection lexicale calculée localement, sans réseau ni coût : nettement moins
bonne, mais la mémoire fonctionne dès le premier jour sans clé.

Les deux espaces vectoriels n'ont rien de commun. Comparer une distance cosinus
de l'un à l'autre produirait un classement arbitraire présenté comme pertinent.
La méthode est donc stockée avec le vecteur (`methode_embedding`) et les
fonctions de recherche filtrent dessus. En cas d'échec OpenAI, **on ne bascule
pas** silencieusement sur le lexical : le vecteur atterrirait dans le mauvais
espace et polluerait durablement l'index.

### L'orchestrateur ne réimplémente aucune barrière

`lancerCycle` appelle `soumettreProposition` — donc `evaluerPermission` puis
`evaluerGardeFous`, le chemin exact du banc d'essai. Deux chemins d'exécution
finiraient par diverger, et c'est celui qui engage de l'argent qui dériverait.

Il ajoute une barrière que les autres n'ont pas : `verifierAncrage`. Les
garde-fous vérifient la taille, pas la vraisemblance du niveau. Un stop à 1,50
sur une paire qui évolue entre 1,075 et 1,085 passerait tous les contrôles de
risque — il est écarté ici, avant même le contrôle de risque, avec le nom de
l'agent fautif.

### L'instantané est la seule source de chiffres

Il est figé, archivé dans `cycles.instantane_donnees`, et rendu aux agents sous
forme tabulaire avec ses trous marqués « donnée manquante ». Le cycle est donc
rejouable et auditable : on peut vérifier après coup qu'un chiffre cité existait
bien.

### Contexte borné, trois budgets

Chaque agent reçoit des résumés, jamais le fil entier : sans cela le coût croît
comme le carré du nombre d'interventions. Trois compteurs coupent un cycle —
appels, secondes, et le plafond de dépense quotidien du profil (5 $ US par
défaut, `profils.plafond_cout_quotidien_usd`). Une marge de sécurité de 0,05 $
précède le plafond : le coût d'un appel n'étant connu qu'après coup, s'arrêter
au plafond exact le dépasserait toujours un peu.

### L'enveloppe : ce que les agents ont le droit d'engager

L'utilisateur a 100 000 en banque et n'en confie que 10 000. Sans traitement,
« 1 % de risque par trade » vaudrait 1 000 alors qu'il croyait en risquer 100.

`portefeuilleDesAgents()` plafonne équité, solde **et sommet d'équité** à
l'enveloppe avant de les passer aux garde-fous. Le sommet compte autant que le
reste : comparer une enveloppe de 10 000 au sommet du compte entier
déclencherait le contrôle de drawdown dès la première allocation.

Ce n'est pas un sous-compte comptable — le solde, l'équité et la marge restent
ceux du portefeuille unique. C'est un plafond d'engagement et une base de
calcul. Défaut fermé : sans allocation, l'équité vue est nulle, toute ouverture
est refusée, et le refus est **expliqué** plutôt que silencieux.

Profits et pertes sont comptés séparément et jamais nets : un net de +200 peut
cacher +5 000 et −4 800.

### Le fil des spécialistes vit dans la salle des marchés

Pas dans l'onglet Agents : c'est là qu'on regarde le marché, c'est là qu'on veut
voir la firme délibérer. Chaque prise de parole est écrite « en cours » puis
complétée, ce qui rend l'attente lisible via Realtime au lieu d'un écran figé
pendant une minute. Un chargement initial complète le direct, que Realtime ne
rejoue pas.

Le poste de commande sépare deux décisions que rien ne doit confondre :
**combien je leur confie** et **peuvent-ils agir seuls**. Fusionnées en un
bouton, on autoriserait l'autonomie en croyant seulement allouer du capital.

### Rejeu historique : cadence côté navigateur

Le curseur vit sur le portefeuille (`rejeu_curseur`), pas dans une table à part :
le moteur avance déjà selon `dernier_horodatage_traite`, et dupliquer l'horloge
garantirait qu'elles divergent.

La cadence est pilotée par le navigateur, qui demande « avance de N bougies ».
Une horloge serveur exigerait un processus survivant entre deux requêtes, ce
qu'un hébergement sans serveur ne fournit pas. Le prochain appel n'est armé
qu'au retour du précédent : la cadence s'adapte d'elle-même à un serveur lent
au lieu d'empiler les requêtes jusqu'à la limite de débit.

Chaque bougie rejouée passe par le même `traiterBougie` que le papier temps
réel. L'ATR est recalculé sur l'historique **connu à cet instant du rejeu** :
utiliser la série entière laisserait le moteur regarder l'avenir.

---

## Dérive entre la base déployée et le dépôt (juillet 2026)

Six migrations avaient été appliquées sur le projet Supabase sans être versionnées ici :
`mandats_accentues`, `mode_conseil`, `strategies_et_recherche_vectorielle`,
`amorcage_strategies`, `methode_embedding`, `recherche_vectorielle_cote_serveur`. Le dépôt ne
pouvait donc plus reconstruire la base déployée — et les types générés décrivaient un schéma
que les migrations du dépôt n'auraient pas produit.

Cinq d'entre elles ont été rapatriées telles qu'appliquées, sous les noms
`20260726150000` à `20260726150400`. La sixième, `mandats_accentues`, n'a rien apporté :
c'est la version accentuée de `initialiser_profil()`, déjà présente dans
`20260726120600_amorcage.sql`.

Ce que ces migrations ajoutent, et qui n'a **pas** de code applicatif dans ce dépôt :

- **`PAPIER_CONSEIL`**, troisième mode d'opération. Intégré côté application par cette phase
  (sélecteur de mode, refus de soumission dans `evaluerPermission`).
- **Table `strategies`** et fonctions `rechercher_strategies` / `rechercher_lecons` : six
  playbooks amorcés, une colonne `agents.famille_strategie`, deux méthodes d'embedding
  (`openai-3-small` et `lexical-1536`). Rien ne les lit encore côté Next.js : c'est de la
  matière pour l'orchestrateur de la phase 4b, pas une fonctionnalité livrée.

Leçon retenue : toute migration appliquée par un outil externe doit être rapatriée dans
`supabase/migrations/` dans la foulée, sans quoi le dépôt cesse d'être la source de vérité.

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

### Un `const` lu avant sa déclaration ne casse que la production

Le journal des placements utilisait `devise`, déclarée quinze lignes plus bas.
La lecture avait lieu dans une fonction fléchée passée à `map` : TypeScript ne
voit rien à redire — la variable existe dans la portée — et le lint par défaut
non plus. L'erreur ne sort qu'à l'exécution, sur le déploiement, sous la forme
parfaitement illisible « Cannot access 'G' before initialization », le nom
étant celui produit par la minification.

Diagnostic par les journaux d'exécution Vercel plutôt qu'à la lecture : la pile
désignait un `Array.map` de la page, ce qui suffisait à pointer le coupable.

`@typescript-eslint/no-use-before-define` est activée pour les variables. La
faute est maintenant refusée au lint, donc avant le déploiement. Vérifiée sur
un cas reproduisant exactement le motif.

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
  viendra avec les déclencheurs planifiés de la phase 4b.
- **Les propositions expirent à l'affichage de la file**, pas par une tâche planifiée. Tant
  qu'il n'y a pas de cron, c'est suffisant : le seul endroit d'où une proposition périmée
  pourrait être approuvée est justement cet écran, et l'approbation revérifie l'échéance.
  À revoir en phase 4b, où des propositions naîtront sans que personne ne regarde.
- **Le quota de trades quotidien compte les propositions acceptées**, pas les ordres remplis.
  Un ordre annulé avant remplissage consomme donc une décision de l'agent. C'est voulu — on
  plafonne les décisions, pas les exécutions — mais ça se voit dans les chiffres.
- **Aucun agent n'agit encore de lui-même.** Les permissions décrivent ce qui *sera* autorisé ;
  seul le banc d'essai emprunte le chemin aujourd'hui. Un agent en « autonome » n'exécutera
  rien tant que l'orchestrateur de la phase 4b n'existe pas.
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

## Vérifications faites en fin de phase 4a

Sur la logique pure, par les tests (28 cas sur les permissions, 146 au total) :

- portefeuille gelé, agent désactivé, agent suspendu — et reprise automatique à l'échéance de
  la suspension ;
- observateur refusé ; droits d'ouverture, de fermeture et de déplacement de stop dissociés ;
- périmètre par classe d'actifs et par symbole, listes vides valant « aucune restriction » ;
- quota quotidien qui bloque une ouverture mais jamais une fermeture ;
- confiance minimale, y compris le cas d'une proposition sans confiance annoncée ;
- taille ramenée au plafond de l'agent, et refus quand le résidu tombe sous 0,01 lot ;
- plafond de taille appliqué **avant** le seuil de validation : un ordre ramené sous le seuil
  redevient autonome au lieu d'attendre une validation pour une taille qui ne sera pas prise ;
- rétrogradation en validation d'un rôle non exécutant marqué autonome ;
- mode `PAPIER_VALIDATION` qui impose la validation, mode `PAPIER_CONSEIL` qui refuse la
  soumission ;
- fusion des plafonds de risque dans les trois cas : agent plus strict, agent plus permissif,
  agent sans plafond propre.

Sur la base déployée, en SQL :

- passer un analyste en `AUTONOME` est refusé par le trigger, et son niveau reste
  `OBSERVATEUR` ;
- les douze lignes de permissions créées à l'amorçage ont produit douze entrées
  `PERMISSION_AGENT_CREEE` dans le journal d'audit ;
- une modification de permission produit une entrée `PERMISSION_AGENT_MODIFIEE` avec le niveau
  avant et après (vérifié en portant la validité du trader à 45 minutes puis en la ramenant à
  30) ;
- une modification sans changement réel n'écrit rien, grâce à la clause
  `when (old.* is distinct from new.*)`.

Non vérifié : le parcours complet depuis le navigateur (soumission par le banc d'essai,
apparition dans la file, approbation) — il exige une session authentifiée que ce conteneur ne
peut pas ouvrir. Le chemin serveur est en revanche le même que celui de l'ordre manuel, déjà
éprouvé en phase 3, et les deux barrières qu'il ajoute sont couvertes par les tests.

---

## Décisions d'architecture (phase 5)

### Les refus sont marqués au même titre que les exécutions

Le graphique porte trois familles de marqueurs : entrées, sorties, et
**propositions non exécutées**. La troisième compte autant que les deux autres.
Sans elle, on ne verrait que les décisions qui ont coûté ou rapporté, jamais
celles qui ont évité une perte. Un garde-fou qui fait son travail est
invisible ; c'est précisément ce qu'il faut rendre visible.

Le survol donne la cause exacte, et les causes ne sont jamais confondues :
refus de permission, refus du moteur de risque, refus de l'utilisateur,
expiration.

### L'alignement sur la bougie n'est pas cosmétique

lightweight-charts ignore **silencieusement** un marqueur dont l'horodatage ne
correspond à aucune bougie. Une décision prise à 10 h 03 sur un graphique M5
doit donc être ramenée à l'ouverture de 10 h 00, faute de quoi elle disparaît
sans erreur ni avertissement. `construireMarqueurs` réaligne à chaque
changement d'intervalle — c'est une fonction pure, testée sur ce point précis.

Le calcul a lieu côté navigateur : le symbole et l'intervalle affichés sont un
état d'interface, et recharger la page à chaque changement d'instrument pour
trois marqueurs serait absurde. Le serveur charge cent décisions tous symboles
confondus, le client filtre.

### Le résultat est affiché tel quel

Une sortie perdante affiche `-320.50` en rouge, pas « sortie ». Un P&L absent
affiche « donnée manquante », pas zéro. C'est la même règle que partout
ailleurs : les chiffres montrés sont des résultats mesurés, jamais adoucis.

### L'agent de réflexion : une position, une leçon, une fois

`reflechirSurPositionsFermees` débriefe les positions fermées sans leçon
rattachée. L'unicité par `position_id` n'est pas un détail : sans elle, la
mémoire se remplirait de doublons et la recherche vectorielle ne rendrait plus
que dix variantes de la même leçon.

Le débrief tourne à la fin de chaque cycle — **après** l'exécution, pour qu'une
position fermée pendant ce cycle soit débriefée dans le même passage — et via
un bouton, pour rattraper l'arriéré après un rejeu qui a fermé trente positions
d'un coup. Deux positions par cycle, cinq par bouton : mieux vaut rattraper sur
plusieurs passages que dépenser tout le budget en débriefs au point de ne plus
pouvoir trader. Le plafond quotidien est revérifié entre chaque position.

L'agent reçoit ce qui était attendu (la vue de marché du cycle d'origine) en
face de ce qui s'est produit. Sans l'attente, il ne resterait que le résultat,
et un résultat seul n'apprend rien. On lui demande explicitement de distinguer
une erreur de méthode d'un simple coup du sort : confondre les deux fait
désapprendre.

Une leçon dont l'embedding échoue est écrite quand même, marquée « non
indexée » dans l'historique. Elle reste lisible mais ne sera jamais resservie à
un agent — c'est dit plutôt que perdu.

---

## Décisions d'interface (tablette et densité)

### Le mode « cockpit » dépend de la hauteur, pas seulement de la largeur

L'application tenait en `h-dvh` avec un défilement interne par panneau. Sur un
écran de bureau c'est le bon choix : graphique, fil et portefeuille d'un seul
coup d'œil.

Première correction, insuffisante : conditionner ce mode à `xl` (1280 px de
large). Une tablette en paysage est **large mais courte** — elle franchissait
donc le seuil, recevait la mise en page bureau, et chaque panneau se retrouvait
écrasé jusqu'à ce que son contenu déborde par-dessus le voisin. Sur une capture
d'écran, le panneau de rejeu était coupé avant ses boutons de vitesse et son
texte explicatif recouvrait le P&L du portefeuille.

La condition porte maintenant sur les deux dimensions :
`@media (min-width: 1280px) and (min-height: 900px)`. Hors de ces conditions,
retour au flux normal : les panneaux prennent la hauteur de leur contenu et
c'est la page entière qui défile. Un panneau un peu long vaut mieux qu'un
panneau illisible.

En cockpit, tous les corps de panneau retrouvent `overflow: auto` — filet de
sécurité pour qu'un contenu trop long défile chez lui au lieu de recouvrir le
panneau suivant. C'est ce filet qui manquait et qui a produit les
chevauchements.

Piège associé : le conteneur du graphique ne peut pas passer en `height: auto`
hors cockpit. Le canevas de lightweight-charts est positionné, il ne donne
aucune hauteur à son parent — le graphique s'effondrerait à zéro. Il garde donc
une hauteur explicite (`60vh`), que le cockpit remplace par 100 %.

### Agrandir le texte sans gonfler la mise en page

Cent vingt classes `text-[10px]` / `text-[11px]` étaient réparties dans le
code : illisibles sur tablette, et intouchables autrement qu'une par une. Elles
sont converties en unités relatives.

Première tentative, à ne pas refaire : relever `html { font-size }` à 18 px
sous 1280 px. Le texte grossit bien, mais **l'échelle d'espacement de Tailwind
est elle aussi en rem** — hauteurs, marges, rembourrages et `min-height` se
retrouvaient gonflés de 12,5 % du même coup. Le graphique devenait démesuré et
toute l'interface respirait trop.

La taille de base reste donc à 16 px. Une règle sous 1280 px ne surcharge que
les quatre classes de texte réellement utilisées, par sélecteurs échappés. Les
utilitaires Tailwind vivent dans `@layer`, la règle non : elle l'emporte dans
la cascade sans `!important`. La mise en page ne bouge pas d'un pixel.

Le graphique, lui, passe de 55 % à 38 % de la hauteur d'écran hors cockpit :
une vitrine de plus de la moitié de l'écran repoussait le journal des
placements et le fil hors de vue.

### Une grille étire ses colonnes, et le graphique suivait

Réduire le pourcentage n'a rien changé, parce que la hauteur ne venait pas de
là. Par défaut, `align-items` vaut `stretch` sur une grille : chaque colonne
prend la hauteur de la plus haute. Le fil des spécialistes grandit à chaque
message ; la colonne centrale s'étirait pour le suivre, et `flex-[3]` donnait
au graphique les trois cinquièmes de cette hauteur. Un cycle bavard produisait
donc un graphique haut de mille pixels — la seule pane visible étant celle du
volume, les chandeliers écrasés à néant.

Deux corrections, indissociables : `items-start` sur la grille, et une hauteur
propre au graphique (`38vh`, plancher 18 rem, plafond 30 rem) au lieu d'une
part de sa colonne. En cockpit — écran large et haut — l'étirement redevient
souhaitable : il est réactivé par `.cockpit-etirer`, et les parts `3/2` par
`.cockpit-part-3` et `.cockpit-part-2`, qui ne font rien hors de ce mode.

### L'ordre d'empilement change avec la largeur

Empilé, le graphique et le poste de commande des agents passent devant le
billet d'ordre — ce sont eux qu'on regarde. Obtenu par `order`, pas par un
second balisage : deux arbres à maintenir divergeraient.

---

## Décisions (fournisseurs de modèles)

### DeepSeek et Mistral partagent l'adaptateur d'OpenAI

Les trois exposent `/v1/chat/completions` avec les mêmes champs et les mêmes
compteurs de tokens. Seules l'URL de base, le nom affiché et la grille
tarifaire changent. Écrire trois fichiers quasi identiques garantirait qu'un
correctif n'en atteigne qu'un.

L'énumération `fournisseur_llm` n'accueille que ce qui est réellement
implémenté et testé : PostgreSQL interdit de retirer une valeur, une liste
d'intentions y resterait pour toujours.

### Un écran distinct des fournisseurs de données

Ce ne sont ni les mêmes comptes, ni les mêmes factures, ni les mêmes
conséquences en cas d'absence : une clé de marché manquante fait basculer le
routeur sur le fournisseur suivant, une clé de modèle manquante rend l'agent
muet. Le stockage reste commun (`cles_api`, AES-256-GCM) — deux mécanismes de
chiffrement en parallèle, c'est un de trop à auditer.

Le test de connexion fait un vrai aller-retour, sur le modèle le moins cher de
la grille : vérifier le format d'une clé ne prouve rien sur sa validité, sur
l'approvisionnement du compte ni sur l'accès au modèle. Le champ de saisie est
vidé dès l'envoi, y compris quand la clé est refusée.

### Vitesses de rejeu exprimées en bougies par seconde

Pas en multiplicateur de temps : « ×100 » n'a pas le même sens sur du M1 et sur
du D1. Cinq cadences, jusqu'à environ 4 000 bougies par seconde — un an de H1
en moins de deux secondes. Le lot par appel est plafonné à 500 côté serveur :
au-delà, la fonction dépasse sa durée maximale d'exécution et le lot entier est
perdu. Pour aller plus vite, on appelle plus souvent, pas plus gros.

---

## Décisions (veille continue et accès au web)

### La clé peut venir de deux endroits, et l'écran dit lequel

La voie prévue était la clé chiffrée en base, saisie dans l'onglet « Clés IA ».
Mais poser sa clé dans les variables d'environnement de l'hébergeur est un
réflexe si répandu qu'ignorer ce cas produit exactement le symptôme rencontré :
`ANTHROPIC_API_KEY` bien présente sur Vercel, application aveugle, et rien qui
explique pourquoi.

`cleDepuisEnvironnement()` lit les noms conventionnels de chaque fournisseur
(`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`…), pas une convention
maison — c'est ce que les gens ont déjà tapé. La base reste prioritaire : une
clé saisie dans l'application est un choix explicite, elle doit primer sur une
variable posée une fois puis oubliée. L'onglet affiche « clé serveur » quand
c'est l'environnement qui fournit, et liste les noms reconnus quand il ne
trouve rien.

Deuxième moitié du symptôme, indépendante : les douze agents sont créés sur le
fournisseur `mock`. Une clé valide ne les fait pas basculer toute seule — il
faut le demander, d'où le bouton « Appliquer aux 12 agents ».

### La veille ne délibère qu'à la bougie

Une boucle qui relance un cycle toutes les minutes sur des chiffres inchangés
produit la même conclusion en la facturant à chaque fois. `veiller()` compare
donc la dernière bougie disponible à celle qu'a vue le dernier cycle, et ne
déclenche que s'il y a du nouveau. La comparaison est serveur : un compteur de
navigateur se remet à zéro à chaque rechargement.

Conséquence assumée : en M5, les agents délibèrent au plus toutes les cinq
minutes, quelle que soit la fréquence d'appel. Pour les faire travailler plus
souvent, on descend l'intervalle ou on lance un rejeu accéléré.

### Deux déclencheurs, deux portées

Le pilote automatique de la salle des marchés vit dans l'onglet : le fermer
l'arrête. C'est la seule option réellement disponible sur le palier gratuit, et
c'est dit à l'écran plutôt que découvert.

`/api/veille` existe pour un ordonnanceur — cron Vercel, GitHub Actions,
cron-job.org. Il n'est activé par rien : sans `SECRET_VEILLE` et `PROFIL_VEILLE`
la route refuse tout. Une route qui déclenche des dépenses ne s'ouvre pas par
défaut. Le palier gratuit de Vercel plafonne les tâches planifiées à un
déclenchement par jour ; une veille réellement continue suppose un forfait
payant ou un ordonnanceur externe. C'est une décision de dépense, elle
appartient au propriétaire.

### Le web est coupé dès que le cycle quitte le temps réel

Barrière anti-look-ahead, appliquée à l'information et non plus seulement aux
prix. Le moteur interdit déjà à un ordre de se remplir sur une bougie
antérieure à sa décision ; sans l'équivalent côté web, un analyste macro
lirait les nouvelles d'aujourd'hui en étudiant une bougie de 2015. Le backtest
cesserait de mesurer une méthode pour mesurer une mémoire — et le résultat
serait flatteur, ce qui est le pire des cas.

`regimeCycle()` bascule en `HISTORIQUE` dans trois situations : un rejeu est en
cours, l'instantané sort du cache hors délai, ou la dernière bougie a plus de
trois intervalles de retard. Le seuil est relatif à l'intervalle : deux heures
de retard sont normales en H4 et anormales en M5.

Le régime prime sur le rôle. Un analyste macro reste privé de web en
historique, même si c'est précisément son métier : mieux vaut une analyse macro
pauvre qu'un backtest faussé. La coupure est annoncée dans le fil — le silence
laisserait croire que les agents ont consulté les nouvelles.

### Trois rôles seulement ont accès au web

Macro, sentiment et fondamental : leur matière première est hors du graphique.
L'analyste technique a déjà tout dans l'instantané — lui donner la recherche
coûterait des tokens sans rien apporter.

La liste de domaines n'est pas une garantie de vérité et l'application ne
prétend pas le contraire. C'est un filtre grossier qui écarte les fermes de
contenu, les sites d'affiliation et les promesses de rendement, au profit de
banques centrales, d'organismes statistiques, d'agences de presse financière et
de calendriers économiques établis. Pas de blogs personnels ni de chaînes
vidéo : leur qualité ne se vérifie pas depuis un nom de domaine, et un mauvais
conseil bien filmé reste un mauvais conseil.

La consigne exige une date sur chaque affirmation tirée du web. « La dernière
décision de la Fed » sans horodatage peut désigner celle de l'an dernier. Les
liens réellement consultés remontent dans le fil : une affirmation invérifiable
ne vaut pas mieux qu'une hallucination bien tournée.

Les outils web sont demandés en liste blanche de modèles (Opus 5, Sonnet 5).
Réclamer un outil à un modèle qui ne le connaît pas fait échouer l'appel
entier, alors que s'en passer ne fait que dégrader la réponse — une analyse
sans recherche vaut mieux que pas d'analyse.

---

## Décisions (véracité des chiffres et multi-marchés)

### Le latent était toujours nul en papier temps réel

Bug réel, signalé par le propriétaire. `appliquerResultat` n'est appelée que
lorsqu'une bougie produit quelque chose — remplissage, fermeture, écriture
comptable. Une position détenue pendant cent bougies calmes ne déclenchait donc
aucune réévaluation en base : `positions.pnl_latent` restait à zéro et
l'enveloppe des agents affichait « Latent 0,00 $ » quel que soit le prix.

`reevaluerOuvertes()` est désormais appelée à la fin de chaque avancée —
temps réel comme rejeu — indépendamment de tout événement. Sans taux de
conversion connu, on s'abstient plutôt que d'écrire zéro : une position à
l'équilibre et une position non évaluable ne sont pas la même chose.

### Le portefeuille se décompose, il ne se résume pas

`P&L cumulé` seul ne se vérifie pas. Le panneau affiche maintenant le réalisé
(solde − capital initial) et le latent (équité − solde) séparément. La
décomposition est exacte par construction du moteur : le solde ne contient que
du réalisé, l'équité vaut solde plus latent. Chacun se recoupe avec le journal
des placements, dont les totaux suivent le filtre actif — filtrer sur
« Agents » donne le résultat des agents, pas celui du compte entier.

### Le journal des placements vit sous le graphique

C'est la lecture naturelle : on regarde le prix, puis ce qu'on en a fait. Chaque
ligne est un fait mesuré — prix d'entrée, prix de sortie, résultat net de
commissions et de swaps — et le motif de sortie dit qui a décidé : stop touché,
cible atteinte, liquidation par manque de marge, fermeture à la main. Les
positions des agents et celles de l'utilisateur portent une étiquette
distincte : sans elle, impossible de savoir d'où vient le résultat du mois.

### Le périmètre se règle pour toute la firme d'un geste

Le réglage par agent existait déjà dans la console. Il répondait mal à la
question la plus fréquente — « sur quoi mes agents ont-ils le droit de
trader ? » — qui aurait demandé douze menus pour exprimer « seulement le
Forex ». Le sélecteur de marchés de la salle des marchés applique le périmètre
à tous les agents en une fois.

Aucune classe cochée signifie « aucune restriction », pas « rien n'est
autorisé » : c'est la convention de `evaluerPermission`, et l'inverser ici
donnerait deux sémantiques à la même colonne. L'interface le dit en toutes
lettres.

### La veille tourne sur les instruments, un par tour

Le pilote automatique ne surveille plus le seul symbole affiché : il fait le
tour du périmètre autorisé. Un instrument par tour et non tous d'un coup —
quatre délibérations simultanées dépasseraient le budget d'une seule et la
durée maximale d'une requête. Le rythme reste dicté par la bougie : chaque
instrument est analysé au plus une fois par bougie fermée.

---

## Limites annoncées franchement (phase 4b)

### Quinze ans d'historique : oui en simulé, non en données réelles

Aucun palier gratuit ne sert quinze ans de bougies M1. Twelve Data et Yahoo
donnent quelques semaines en intraday et plusieurs années en journalier. Deux
sources sont donc proposées, et l'interface dit laquelle est active :

| Intervalle | Simulé | Fournisseur réel |
| --- | --- | --- |
| M1 | 15 ans | ~30 jours |
| M5 / M15 / M30 | 15 ans | 60 à 180 jours |
| H1 / H4 | 15 ans | ~2 ans |
| D1 / W1 | 15 ans | ~15 ans |

La série simulée est déterministe et cohérente, mais **ce n'est pas le vrai
marché** : c'est un banc d'essai du moteur, des agents et des garde-fous, pas
une performance passée. Les profondeurs « fournisseur » sont volontairement
prudentes — mieux vaut annoncer un mois et le tenir que promettre quinze ans et
rendre trois jours. Aucun trou n'est jamais comblé par de la donnée inventée.

### Le rejeu sur données réelles ne remonte pas au-delà du cache

`obtenirChandeliers` sert la fenêtre la plus récente : un rejeu `FOURNISSEUR`
part donc de ce que le cache et le fournisseur détiennent. C'est dit au
démarrage plutôt que découvert à mi-parcours.

### Le latent vaut au dernier horodatage traité

`positions.pnl_latent` est écrit à chaque bougie traitée par le moteur, pas à
l'instant de l'affichage. Rafraîchir la page ne le recalcule pas : il faut que
le moteur avance. L'interface le dit sous les cellules plutôt que de laisser
supposer un temps réel qui n'existe pas.

### Le cycle s'exécute dans la requête, sans file d'attente

Le palier gratuit n'offre pas de file, et une file bricolée à coups de
`setTimeout` ne survit pas à la fin de la fonction. Contrepartie : un cycle long
peut dépasser la durée maximale d'exécution. Toutes les étapes déjà franchies
restent écrites en base — c'est exactement ce que garantit l'écriture à chaque
transition — mais le cycle restera dans son dernier état au lieu d'être marqué
`TERMINE`. Un déclencheur planifié (cron Vercel) reste à faire.

### Le calendrier macroéconomique n'est toujours pas branché

`evaluerGardeFous` reçoit une liste d'événements vide : le contrôle
`EVENEMENT_MACRO` passe donc systématiquement. Le code est là, la source de
données manque.

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
