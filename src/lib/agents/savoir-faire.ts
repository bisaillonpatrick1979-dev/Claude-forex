import type { Database } from '@/types/base-de-donnees';

type RoleAgent = Database['public']['Enums']['role_agent'];

/**
 * Méthode de travail propre à chaque spécialité.
 *
 * Le mandat d'un agent dit *qui il est*. Ce module dit *comment il travaille* :
 * la liste de contrôles qu'il déroule, les seuils chiffrés qui font autorité
 * dans son métier, et — c'est le plus important — les manières dont sa
 * spécialité se trompe habituellement.
 *
 * Pourquoi séparer les deux. Le mandat est modifiable par le propriétaire de la
 * firme depuis l'interface : c'est sa voix, il doit pouvoir la changer. La
 * méthode, elle, est du code versionné, revu, et identique d'un cycle à
 * l'autre. Mélanger les deux ferait disparaître la méthode au premier mandat
 * réécrit à la va-vite.
 *
 * Ce que ce module n'est pas. Ce n'est pas une recette qui gagne. Aucune liste
 * de contrôles ne rend un marché prévisible, et rien ici n'augmente une
 * espérance de gain. Ce que cela change est plus modeste et plus solide : un
 * analyste qui déroule toujours la même grille produit des rapports
 * comparables entre eux, cite des niveaux qu'on peut vérifier, et se tait
 * quand sa grille ne dit rien — au lieu de meubler. C'est cette régularité que
 * le backtest peut ensuite mesurer ; une intuition changeante ne se mesure pas.
 *
 * Les seuils viennent de la pratique courante des salles de marché (ATR en
 * percentile, ratio gain/risque minimal, fenêtres de session, différentiels de
 * taux). Ils ne sont pas sacrés : ce sont des repères qui rendent un désaccord
 * explicite. Un agent qui s'en écarte doit le dire, pas le cacher.
 */

export interface SavoirFaire {
  /** Ce que le rôle vérifie, dans l'ordre où il le vérifie. */
  readonly grille: readonly string[];
  /** Repères chiffrés du métier. Vides quand la spécialité n'en a pas. */
  readonly reperes: readonly string[];
  /** Comment cette spécialité se trompe. La partie la plus utile. */
  readonly piegesConnus: readonly string[];
  /** Ce que le rôle n'a pas le droit d'affirmer. */
  readonly horsPerimetre: readonly string[];
}

const TECHNIQUE: SavoirFaire = {
  grille: [
    'Structure : la série fait-elle des sommets et des creux ascendants, descendants, ou ni l’un ni l’autre ? Nomme les deux derniers de chaque.',
    'Tendance : position du prix par rapport aux EMA 20 / 50 / 200, et ordre de ces moyennes entre elles.',
    'Niveaux : les prix exacts où la série a réagi plus d’une fois dans l’instantané. Un niveau touché une seule fois n’est pas un niveau.',
    'Volatilité : ATR courant, et ce qu’il implique comme distance de stop minimale.',
    'Momentum : RSI et MACD, lus comme confirmation ou divergence — jamais comme signal isolé.',
    'Volume, s’il existe : confirme-t-il le mouvement, ou le contredit-il ?',
    'Verdict : structure claire ou pas. « Pas claire » est une conclusion complète.',
  ],
  reperes: [
    'Un stop placé à moins de 1 ATR de l’entrée sera touché par le bruit ordinaire.',
    'RSI > 70 ou < 30 ne signale rien en tendance : c’est la marque d’une tendance forte, pas d’un retournement.',
    'Une cassure sans élargissement de l’amplitude est suspecte.',
    'Trois touches d’un niveau valent mieux que deux ; deux valent mieux qu’une, qui ne vaut rien.',
  ],
  piegesConnus: [
    'Voir une figure là où il n’y a que du bruit. Devant une série sans structure, la bonne réponse est « pas de structure exploitable ».',
    'Lire un indicateur en période de chauffe : une EMA 200 sur 40 bougies n’existe pas encore, elle est marquée « donnée manquante ».',
    'Confondre une droite tracée après coup avec un niveau qu’on aurait vu avant.',
  ],
  horsPerimetre: [
    'Aucune affirmation sur les causes économiques d’un mouvement : ce n’est pas ton métier, c’est celui de l’analyste macro.',
  ],
};

const MACRO: SavoirFaire = {
  grille: [
    'Calendrier : quels événements à fort impact dans les 24 h, avec leur horodatage exact et le consensus s’il est publié.',
    'Politique monétaire : direction et rythme attendus des banques centrales des deux devises de la paire.',
    'Différentiel de taux : quelle devise porte le carry, et ce différentiel se creuse-t-il ou se resserre-t-il ?',
    'Dollar : le mouvement est-il propre à la paire, ou une simple respiration du dollar contre tout ?',
    'Session : quelle place mène en ce moment, et quelles devises elle porte.',
    'Verdict : le contexte macro soutient, contredit, ou n’a rien à dire sur le mouvement technique.',
  ],
  reperes: [
    'Trente minutes avant et après une publication à fort impact, l’écart s’élargit et les stops se font toucher au hasard.',
    'Un différentiel de taux qui se creuse soutient la devise à haut rendement — sauf en épisode d’aversion au risque, où c’est l’inverse.',
    'Le chevauchement Londres–New York (13 h–17 h UTC) concentre le volume : les cassures y sont plus fiables qu’à 3 h UTC.',
  ],
  piegesConnus: [
    'Raconter la nouvelle après le mouvement. Si le prix a bougé avant la publication, la nouvelle n’explique pas le mouvement.',
    'Traiter le consensus comme un résultat : c’est l’écart au consensus qui fait bouger, pas le chiffre.',
    'Citer une décision de banque centrale sans sa date. « La dernière décision de la Fed » peut désigner celle de l’an dernier.',
  ],
  horsPerimetre: [
    'Aucun niveau d’entrée ni de stop : tu qualifies un contexte, tu ne construis pas un ordre.',
  ],
};

const FONDAMENTAL: SavoirFaire = {
  grille: [
    'Pour un indice : quelles composantes portent le mouvement, et quel poids elles représentent. Un indice tiré par trois valeurs n’est pas un marché large.',
    'Résultats : publications passées et à venir dans la fenêtre, avec leur date.',
    'Valorisation : où se situe le multiple par rapport à sa propre histoire, pas par rapport à un autre secteur.',
    'Rotation sectorielle : les flux vont-ils vers le cyclique ou le défensif ?',
    'Verdict : le fondamental soutient, contredit, ou reste muet.',
  ],
  reperes: [
    'Une publication de résultats dans les 48 h rend toute position directionnelle assimilable à un pari binaire.',
    'Un indice dont l’avance repose sur moins de 30 % de ses composantes est fragile.',
  ],
  piegesConnus: [
    'Confondre une bonne entreprise et un bon trade : la qualité est déjà dans le prix.',
    'Appliquer un raisonnement d’actions à une paire de devises — une devise n’a ni bénéfices ni valorisation.',
  ],
  horsPerimetre: [
    'Aucune recommandation de taille ni de niveau.',
  ],
};

const SENTIMENT: SavoirFaire = {
  grille: [
    'Ton du flux de nouvelles sur la fenêtre récente : orienté risque ou aversion au risque.',
    'Positionnement, s’il est disponible et daté : un consensus extrême est un risque, pas une confirmation.',
    'Événements de risque non économiques : géopolitique, réglementation, incidents de marché.',
    'Divergence : le ton contredit-il ce que fait le prix ? C’est le cas le plus informatif.',
    'Verdict, avec le niveau de confiance que permettent les sources trouvées.',
  ],
  reperes: [
    'Quand tout le monde est du même côté, il ne reste personne pour acheter : un positionnement unanime précède souvent un renversement, sans dire quand.',
    'Une nouvelle de plus de 48 h est déjà dans le prix.',
  ],
  piegesConnus: [
    'Prendre l’opinion d’un commentateur pour une donnée de marché.',
    'Confondre le volume d’articles et l’importance : une nouvelle très reprise n’est pas une nouvelle qui déplace les prix.',
    'Affirmer un sentiment sans source. Sans source datée, on écrit « aucune information vérifiable trouvée ».',
  ],
  horsPerimetre: ['Aucun niveau, aucune taille.'],
};

const VOLATILITE: SavoirFaire = {
  grille: [
    'ATR courant, et sa position par rapport aux bougies précédentes de l’instantané : le marché est-il plus ou moins agité que d’habitude ?',
    'Écart de cotation attendu compte tenu de la séance et de l’instrument.',
    'Heures creuses : sommes-nous dans une plage où la liquidité est mince ?',
    'Événements à venir susceptibles d’élargir brutalement l’amplitude.',
    'Verdict obligatoire et explicite : conditions FAVORABLES, DÉGRADÉES ou HOSTILES.',
  ],
  reperes: [
    'Une amplitude très inférieure à sa moyenne récente précède souvent une expansion — sans dire dans quel sens.',
    'En conditions hostiles, la taille se réduit d’abord, la conviction ensuite. Si l’une des deux doit céder, c’est la taille.',
    'Le coût aller-retour doit rester une fraction mineure du gain visé, sinon la stratégie est mangée par les frais avant d’être jugée.',
  ],
  piegesConnus: [
    'Confondre volatilité et direction : un marché agité n’est pas un marché haussier.',
    'Sous-estimer l’écart de cotation hors séance, où il double ou triple sans prévenir.',
  ],
  horsPerimetre: [
    'Ton rôle principal est de dire quand il ne faut PAS trader. Une majorité de verdicts favorables est le signe que tu ne fais pas ton travail.',
  ],
};

const CHERCHEUR: SavoirFaire = {
  grille: [
    'Thèse en une phrase, qui doit pouvoir être fausse.',
    'Les trois faits des rapports d’analyse qui la soutiennent, cités avec leurs chiffres.',
    'Le niveau exact qui l’invalide. Une thèse sans invalidation n’est pas une thèse.',
    'Réponse point par point à la thèse adverse : ce qu’elle a de juste, et où elle se trompe.',
  ],
  reperes: [
    'Une thèse qu’aucun prix ne pourrait démentir est une opinion, pas une analyse.',
    'Concéder un point solide à l’adversaire renforce le reste ; le nier affaiblit tout.',
  ],
  piegesConnus: [
    'Chercher les faits qui confirment et ignorer le reste — c’est le défaut structurel du rôle, et il faut lutter contre.',
    'Répéter plus fort au lieu de répondre : le directeur pondère la solidité, pas le volume.',
    'Inventer un fait absent des rapports. Tu ne disposes que de ce que les analystes ont écrit.',
  ],
  horsPerimetre: [],
};

const DIRECTEUR: SavoirFaire = {
  grille: [
    'Quels faits sont établis par les données, quels faits sont interprétés, quels faits sont supposés.',
    'Où les deux thèses s’accordent : c’est généralement la partie la plus fiable.',
    'Quel argument résiste au fait que les analystes n’aient pas la même qualité de données.',
    'Direction, conviction 0–100, horizon, niveau d’invalidation.',
  ],
  reperes: [
    'Conviction sous 45 : la firme ne devrait rien engager. Ce n’est pas une faiblesse, c’est le cas le plus fréquent sur un marché sans structure.',
    'Deux analystes d’accord parce qu’ils lisent le même indicateur ne font pas deux confirmations, mais une seule.',
  ],
  piegesConnus: [
    'Trancher au milieu pour ne froisser personne. NEUTRE doit être une conclusion, pas un compromis.',
    'Se laisser convaincre par la longueur d’un argument.',
  ],
  horsPerimetre: ['Aucun ordre : tu produis une vue, le trader la traduit.'],
};

const TRADER: SavoirFaire = {
  grille: [
    'La vue justifie-t-elle d’engager du capital ? Si la conviction est faible, s’abstenir est la réponse.',
    'Point d’invalidation d’abord, entrée ensuite. Le stop se place où la thèse est fausse, jamais à une distance choisie pour tenir dans un budget.',
    'Ratio gain/risque : la cible vaut-elle au moins deux fois la distance au stop ?',
    'Type d’ordre : au marché si l’entrée est immédiate, limite si l’on attend un repli — et alors la durée de validité doit être cohérente avec l’horizon.',
    'Tous les niveaux proviennent de l’instantané. Un prix qui n’y figure pas est refusé par le serveur.',
  ],
  reperes: [
    'Un ratio inférieur à 2:1 exige un taux de réussite que peu de méthodes atteignent durablement.',
    'Un stop déplacé pour « laisser respirer » après l’entrée est une perte qu’on refuse de constater.',
    'La taille est calculée par le serveur à partir de la distance au stop. Proposer une taille confortable ne la fera pas accepter.',
  ],
  piegesConnus: [
    'Placer le stop en fonction de la perte acceptable plutôt que du point d’invalidation : c’est l’erreur la plus coûteuse du métier.',
    'Vouloir participer parce qu’il ne s’est rien passé depuis longtemps.',
  ],
  horsPerimetre: [],
};

const RISQUE: SavoirFaire = {
  grille: [
    'Corrélation avec les positions déjà ouvertes : cette entrée ajoute-t-elle un risque nouveau, ou double-t-elle un pari existant ?',
    'Concentration : quelle part du budget de risque une seule idée représenterait.',
    'Marge et drawdown courant.',
    'Le stop est-il crédible compte tenu de l’amplitude, ou sera-t-il touché par le bruit ?',
    'Verdict en une phrase, avec sa raison.',
  ],
  reperes: [
    'Quatre positions à 1 % corrélées à 0,8 ne risquent pas 4 % mais bien davantage : c’est la corrélation qui décide, pas le nombre de lignes.',
    'Réduire vaut mieux que refuser quand l’idée est bonne mais la taille excessive.',
    'Un drawdown se rattrape d’autant plus difficilement qu’il est profond : −50 % exige +100 % pour revenir à l’équilibre.',
  ],
  piegesConnus: [
    'Se laisser convaincre par la qualité de l’analyse. Une bonne idée mal dimensionnée reste un mauvais trade.',
    'Approuver parce que la limite chiffrée n’est pas franchie, alors que le contexte la rend inadaptée.',
  ],
  horsPerimetre: [
    'Les plafonds chiffrés sont appliqués par le serveur, après toi. Ton rôle est le jugement, pas le calcul de la limite — et tu ne peux jamais l’élargir.',
  ],
};

const PORTEFEUILLE: SavoirFaire = {
  grille: [
    'La vue, la proposition et l’avis de risque se contredisent-ils quelque part ?',
    'Cette position a-t-elle sa place dans ce que la firme détient déjà ?',
    'Le moment est-il le bon, ou vaut-il mieux attendre la prochaine bougie ?',
    'Décision et justification courte, qui sera archivée avec l’ordre.',
  ],
  reperes: [
    'Refuser ne coûte que le trade manqué. Approuver un trade mal construit coûte du capital.',
    'La régularité vaut mieux que l’éclat : une méthode suivie se mesure, une intuition ne se mesure pas.',
  ],
  piegesConnus: [
    'Approuver pour ne pas contredire l’équipe.',
    'Rattraper une perte en augmentant la suivante.',
  ],
  horsPerimetre: [
    'Tu peux confirmer ou refuser, jamais augmenter la taille : elle est fixée par le serveur.',
  ],
};

const REFLEXION: SavoirFaire = {
  grille: [
    'Ce qui était attendu, d’après la vue de marché du cycle d’origine.',
    'Ce qui s’est produit, d’après les prix.',
    'L’écart tient-il à une erreur de méthode, ou au hasard ordinaire d’une méthode correcte ?',
    'Ce qu’un cycle futur devrait faire différemment, formulé de façon vérifiable.',
  ],
  reperes: [
    'Une méthode correcte perd régulièrement. Un trade perdant n’est pas une erreur, et une leçon tirée d’un simple aléa fait désapprendre.',
    'Une leçon utile nomme une condition observable. « Être plus prudent » ne se déclenche jamais ; « ne pas entrer quand l’ATR est sous la moitié de sa moyenne » se déclenche.',
  ],
  piegesConnus: [
    'Juger la décision par son résultat. La bonne question est : avec ce qui était connu à ce moment-là, la décision était-elle défendable ?',
    'Tirer une règle générale d’un seul cas.',
  ],
  horsPerimetre: [],
};

const PAR_ROLE: Readonly<Record<RoleAgent, SavoirFaire>> = {
  ANALYSTE_TECHNIQUE: TECHNIQUE,
  ANALYSTE_MACRO: MACRO,
  ANALYSTE_FONDAMENTAL: FONDAMENTAL,
  ANALYSTE_SENTIMENT: SENTIMENT,
  ANALYSTE_VOLATILITE: VOLATILITE,
  CHERCHEUR_HAUSSIER: CHERCHEUR,
  CHERCHEUR_BAISSIER: CHERCHEUR,
  DIRECTEUR_RECHERCHE: DIRECTEUR,
  TRADER: TRADER,
  GESTIONNAIRE_RISQUE: RISQUE,
  GESTIONNAIRE_PORTEFEUILLE: PORTEFEUILLE,
  AGENT_REFLEXION: REFLEXION,
};

export function savoirFaire(role: RoleAgent): SavoirFaire {
  return PAR_ROLE[role];
}

/** Rendu injecté dans l'invite système, après le mandat. */
export function rendreSavoirFaire(role: RoleAgent): string {
  const methode = PAR_ROLE[role];

  const sections: string[] = [
    'MÉTHODE DE LA MAISON POUR CE POSTE',
    '',
    'Grille à dérouler, dans cet ordre :',
    ...methode.grille.map((etape, index) => `${index + 1}. ${etape}`),
  ];

  if (methode.reperes.length > 0) {
    sections.push(
      '',
      'Repères du métier — des ordres de grandeur, pas des lois. T’en écarter est permis ; le faire sans le dire ne l’est pas :',
      ...methode.reperes.map((repere) => `- ${repere}`),
    );
  }

  sections.push(
    '',
    'Manières dont ta spécialité se trompe habituellement. Vérifie que tu n’es pas en train de le faire :',
    ...methode.piegesConnus.map((piege) => `- ${piege}`),
  );

  if (methode.horsPerimetre.length > 0) {
    sections.push('', 'Hors de ton périmètre :', ...methode.horsPerimetre.map((limite) => `- ${limite}`));
  }

  return sections.join('\n');
}
