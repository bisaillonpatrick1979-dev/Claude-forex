-- Playbooks fournis avec l'application (profil_id nul).
-- Chacun dit explicitement quand il échoue : une méthode sans cas d'échec est
-- une méthode qu'on applique jusqu'à la ruine.
insert into public.strategies
  (profil_id, code, nom, famille, horizons, classes_actifs, resume,
   conditions_marche, regles_entree, regles_sortie, gestion_taille, cas_echec)
values
(null, 'SCALPING_MOMENTUM', 'Scalping de momentum', 'SCALPING',
 '{M1,M5}', '{FOREX,INDICE,CRYPTO}',
 'Capter une impulsion courte dans le sens du flux dominant, sur quelques minutes, en sortant avant l''essoufflement.',
 'Séance active uniquement : chevauchement Londres/New York pour le Forex, première heure après l''ouverture pour les indices. Spread au plus 1,5 fois sa médiane. ATR(14) sur M5 au-dessus de sa moyenne des 20 dernières bougies. À proscrire en séance asiatique sur les paires majeures et dans les 30 minutes autour d''une publication à fort impact.',
 'Trois bougies M5 consécutives dans le même sens avec corps croissants, puis entrée sur le repli qui ne dépasse pas 50 % de la dernière bougie. La moyenne mobile 20 doit être orientée dans le sens du trade et le prix se tenir du bon côté. Pas d''entrée si le mouvement dépasse déjà 2 ATR depuis son point de départ : le plus facile est fait.',
 'Stop à 1 ATR(14) M5 au-delà du point de repli. Cible initiale à 1,5 fois le risque. Sortie immédiate si deux bougies M5 clôturent contre la position, sans attendre le stop. Durée de vie maximale : 12 bougies M5 — au-delà, l''impulsion est morte et on sort au marché.',
 'Le coût de transaction domine : à 1,0 pip de spread sur un objectif de 8 pips, les frais mangent 12 % du gain brut. Ne pas dépasser 0,5 % de risque par trade, et arrêter la session après trois pertes consécutives.',
 'Échoue en marché sans direction, où les impulsions s''annulent : la succession de petites pertes plus les frais creuse le compte plus vite que ne le laisse croire le taux de réussite. Échoue aussi quand le spread s''élargit, ce qui arrive précisément quand la volatilité attire. Un taux de réussite de 60 % ne suffit pas si le ratio gain/perte tombe sous 1.'),

(null, 'RETOUR_MOYENNE', 'Retour à la moyenne en range', 'RETOUR_MOYENNE',
 '{M15,M30,H1}', '{FOREX,INDICE,ACTION}',
 'Vendre les excès haussiers et acheter les excès baissiers à l''intérieur d''un range identifié, en pariant sur le retour vers la moyenne.',
 'Range établi : au moins deux touches du haut et deux du bas sur les 50 dernières bougies, avec une amplitude d''au moins 3 ATR. Moyenne mobile 50 plate — pente inférieure à 0,2 ATR sur 20 bougies. Aucune publication macro à fort impact dans les heures qui suivent.',
 'Entrée à l''approche d''une borne, jamais dessus : à 0,3 ATR de la borne, avec un RSI(14) au-dessus de 70 pour une vente ou sous 30 pour un achat. Attendre une bougie de rejet — mèche d''au moins 50 % du corps du côté de la borne.',
 'Stop à 1 ATR au-delà de la borne. Première cible à la moyenne mobile 20, deuxième à la borne opposée. Sortie de la totalité si le prix clôture au-delà de la borne : le range est cassé, la thèse est morte.',
 'Risque de 0,75 % par trade au plus. Ne jamais moyenner à la baisse dans un range : c''est la façon la plus courante de transformer une petite perte en perte majeure.',
 'Échoue à la sortie du range, et le range finit toujours par sortir. Les pertes arrivent groupées et sont plus grosses que les gains individuels : la stratégie gagne souvent et perd gros. À proscrire quand la volatilité se contracte fortement — c''est le signe précurseur d''une cassure, pas d''un range durable.'),

(null, 'CASSURE_RANGE', 'Cassure de range', 'CASSURE',
 '{M15,H1,H4}', '{FOREX,INDICE,CRYPTO,MATIERE_PREMIERE}',
 'Entrer dans le sens de la sortie d''une zone de compression, en acceptant un taux de réussite faible pour des gains nettement supérieurs aux pertes.',
 'Compression identifiable : ATR(14) sous sa moyenne des 50 dernières bougies, amplitude des 20 dernières bougies inférieure à celle des 20 précédentes. Volume en baisse pendant la compression quand la donnée existe. La cassure gagne en fiabilité si elle coïncide avec une ouverture de séance.',
 'Ordre stop placé 0,2 ATR au-delà de la borne, jamais au marché sur la bougie de cassure. Exiger une clôture au-delà de la borne, pas une simple mèche. Pas d''entrée si le mouvement s''est déjà déployé de plus de 1 ATR au-delà de la borne : le point d''entrée favorable est passé.',
 'Stop de l''autre côté de la zone de compression, jamais juste sous la borne cassée — c''est là que se logent les faux signaux. Cible à 2 fois la hauteur de la zone. Remonter le stop au point mort dès que le prix a parcouru 1 fois le risque.',
 'Risque de 1 % par trade. Comme le taux de réussite est bas — souvent entre 35 et 45 % — la taille doit rester constante : réduire après une perte casse l''espérance qui repose sur quelques gros gains.',
 'Échoue par les fausses cassures, qui sont la majorité des cas. Une série de six à huit pertes consécutives est normale et ne prouve rien contre la stratégie ; c''est aussi ce qui la rend psychologiquement difficile à tenir. Échoue complètement en marché sans compression préalable : sans zone identifiable, il n''y a pas de cassure, seulement du bruit.'),

(null, 'SUIVI_TENDANCE', 'Suivi de tendance', 'TENDANCE',
 '{H4,D1,W1}', '{FOREX,INDICE,ACTION,MATIERE_PREMIERE}',
 'Rester dans le sens du mouvement dominant aussi longtemps qu''il dure, en acceptant de rendre une partie du gain à chaque sortie.',
 'Tendance établie : moyenne mobile 50 au-dessus de la 200 pour une hausse, l''inverse pour une baisse, avec les deux orientées dans le même sens. Structure de plus hauts et plus bas croissants sur au moins trois oscillations. Sans ces deux conditions simultanées, il n''y a pas de tendance, seulement une hausse récente.',
 'Entrée sur repli vers la moyenne mobile 20 ou 50, avec une bougie de reprise dans le sens de la tendance. Ne jamais entrer sur une extension : si le prix est à plus de 2 ATR de la moyenne 20, attendre.',
 'Stop sous le dernier plus bas significatif, pas à distance fixe. Aucune cible fixe : suivre avec un stop remonté sous chaque nouveau plus bas confirmé. Sortie quand le prix clôture sous la moyenne mobile 50 ou quand la structure de plus hauts croissants se casse.',
 'Risque de 1 % par trade. La position peut être renforcée une seule fois, sur un second repli, à condition que le stop de l''ensemble reste sous 1,5 % du capital.',
 'Échoue en marché latéral, où chaque « repli » devient une borne de range et déclenche les stops. Le taux de réussite est bas — 30 à 40 % — et l''essentiel du résultat vient d''un petit nombre de trades ; couper les gagnants trop tôt détruit la stratégie plus sûrement que laisser courir les perdants. Exige de la patience : plusieurs semaines sans signal valide sont normales.'),

(null, 'PULLBACK_SESSION', 'Repli d''ouverture de session', 'TENDANCE',
 '{M5,M15,M30}', '{FOREX,INDICE}',
 'Exploiter le mouvement directionnel qui suit souvent l''ouverture de Londres ou de New York, en entrant sur le premier repli plutôt que sur l''impulsion.',
 'Première heure après l''ouverture de Londres (07:00 UTC) ou de New York (13:30 UTC). Un déplacement initial d''au moins 1 ATR dans une direction claire. Volatilité de la séance précédente pas anormalement basse, ce qui signalerait un jour férié ou une veille de publication majeure.',
 'Attendre le premier repli de 30 à 50 % du déplacement initial, puis entrer sur la reprise. L''entrée ne se fait jamais sur l''impulsion elle-même : le risque y est maximal et le point d''entrée le pire de la séance.',
 'Stop sous le point bas du repli pour un achat. Cible au niveau du déplacement initial reporté depuis le point de repli. Sortie systématique avant la fin de la séance concernée : le mouvement d''ouverture ne survit pas à la séance.',
 'Risque de 0,75 % par trade, un seul trade par ouverture de séance. Deux entrées sur la même ouverture reviennent presque toujours à doubler la même thèse.',
 'Échoue les jours où l''ouverture ne produit aucune direction, ce qui arrive une séance sur trois environ. Échoue aussi quand une publication macro tombe pendant la première heure : le mouvement d''ouverture est alors remplacé par une réaction à la nouvelle, dont la mécanique est différente. Ne jamais forcer un trade parce que la séance vient de s''ouvrir.'),

(null, 'NON_INTERVENTION', 'Ne pas trader', 'DISCIPLINE',
 '{M1,M5,M15,M30,H1,H4,D1,W1}', '{FOREX,INDICE,ACTION,CRYPTO,MATIERE_PREMIERE}',
 'Reconnaître les états de marché où aucune stratégie n''a d''avantage, et s''abstenir. C''est une décision à part entière, pas une absence de décision.',
 'S''applique quand au moins une condition est vraie : spread au-delà de 2 fois sa médiane ; moins de 30 minutes avant une publication à fort impact ; séance de très faible liquidité ; perte journalière déjà proche de la limite ; drawdown courant au-delà de la moitié du plafond ; aucune structure lisible sur les deux unités de temps supérieures.',
 'Aucune entrée. Le trader et le gestionnaire de portefeuille doivent proposer explicitement de ne rien faire, et cette proposition a le même statut qu''une proposition d''achat ou de vente.',
 'Les positions déjà ouvertes conservent leur stop et leur cible. On ne ferme pas par précaution : on ferme sur invalidation de la thèse.',
 'Sans objet.',
 'Le seul risque de cette stratégie est de ne jamais l''appliquer. Le biais d''action — l''impression qu''une journée sans trade est une journée perdue — est la cause la plus commune de pertes évitables. Une séance sans signal valide est un résultat normal, pas un échec.');
