import type { SupabaseClient } from '@supabase/supabase-js';

import { chargerEtat, chargerInstrument } from '@/lib/execution/persistance';
import { appelerModele, type ResultatAppel } from '@/lib/ia/appel';
import { budgetSuffisant, etatBudget, type EtatBudget } from '@/lib/ia/budget';
import { ErreurLLM, type ContexteDeterministe, type MessageLLM } from '@/lib/ia/types';
import { obtenirChandeliers } from '@/lib/marche/routeur';
import type { Intervalle } from '@/lib/marche/types';
import type { ParametresRisque } from '@/lib/risque/garde-fous';
import type { Database } from '@/types/base-de-donnees';

import {
  analyser,
  schemaDecisionPm,
  schemaProposition,
  schemaVueMarche,
  verifierAncrage,
  type Proposition,
} from './extraction';
import { construireInstantane, rendreInstantane } from './instantane';
import {
  chargerAgents,
  completerMessage,
  majEtatCycle,
  messageSysteme,
  ouvrirMessage,
  type AgentCharge,
} from './journal-cycle';
import {
  construireSysteme,
  messageInstantane,
  messagePortefeuille,
  resumerPourSuite,
} from './invites';
import { recupererLecons, recupererStrategies } from './recuperation';

import { soumettreProposition } from '@/app/actions/propositions';

type Client = SupabaseClient<Database>;
type RoleAgent = Database['public']['Enums']['role_agent'];
type EtatCycle = Database['public']['Enums']['etat_cycle'];

/**
 * Machine à états du cycle de décision.
 *
 * COLLECTE_DONNEES → ANALYSE → DÉBAT → SYNTHÈSE → PROPOSITION →
 * CONTRÔLE_RISQUE → DÉCISION_PM → EXÉCUTION → JOURNALISATION.
 *
 * Trois principes tiennent l'ensemble :
 *
 *  - Chaque transition est écrite en base avant de passer à la suivante. Une
 *    fonction serverless qui meurt en cours de route laisse donc un cycle dont
 *    on sait exactement où il s'est arrêté, pas un trou.
 *  - Le contexte de chaque agent est borné : des résumés, jamais le fil entier.
 *    Sans cela le coût croît comme le carré du nombre d'interventions.
 *  - Le passage par `evaluerGardeFous` est structurel. L'agent gestionnaire de
 *    risque donne un avis ; c'est la fonction TypeScript qui décide. Un modèle
 *    n'est jamais la dernière barrière avant une perte.
 */

const ROLES_ANALYSTES: readonly RoleAgent[] = [
  'ANALYSTE_TECHNIQUE',
  'ANALYSTE_MACRO',
  'ANALYSTE_FONDAMENTAL',
  'ANALYSTE_SENTIMENT',
  'ANALYSTE_VOLATILITE',
];

export interface OptionsCycle {
  readonly client: Client;
  readonly profilId: string;
  readonly symbole: string;
  readonly intervalle: Intervalle;
  readonly declencheur?: Database['public']['Enums']['declencheur_cycle'];
  readonly toursDebat?: number;
  readonly budgetAppels?: number;
  readonly budgetSecondes?: number;
}

export interface ResultatCycle {
  readonly ok: boolean;
  readonly cycleId: string | null;
  readonly etatFinal: EtatCycle;
  readonly message: string;
  readonly propositionId?: string | null;
  readonly coutUsd: number;
  readonly appels: number;
}

/** Compteurs de budget. Un cycle qui les dépasse s'arrête proprement à l'étape
 *  courante plutôt que de rendre une décision bâclée. */
class Compteur {
  private appelsUtilises = 0;
  private cout = 0;
  private readonly debut = Date.now();

  constructor(
    private readonly appelsMax: number,
    private readonly secondesMax: number,
    private readonly budget: EtatBudget,
  ) {}

  /** Raison du refus, ou `null` si un appel de plus est permis. */
  obstacle(): string | null {
    if (this.appelsUtilises >= this.appelsMax) {
      return `Budget d’appels du cycle épuisé (${this.appelsMax}).`;
    }
    if ((Date.now() - this.debut) / 1000 >= this.secondesMax) {
      return `Budget de temps du cycle épuisé (${this.secondesMax} s).`;
    }
    const restant = this.budget.restantUsd - this.cout;
    if (restant <= 0.05) {
      return `Plafond de dépense quotidien atteint (${this.budget.plafondUsd.toFixed(2)} $ US). Les agents sont en pause jusqu’à demain (UTC).`;
    }
    return null;
  }

  enregistrer(appel: ResultatAppel): void {
    this.appelsUtilises += 1;
    this.cout += appel.coutUsd ?? 0;
  }

  get total(): { appels: number; cout: number } {
    return { appels: this.appelsUtilises, cout: this.cout };
  }
}

interface Sequence {
  valeur: number;
}

async function lireParametresRisque(
  client: Client,
  profilId: string,
): Promise<ParametresRisque | null> {
  const { data } = await client
    .from('parametres_risque')
    .select('*')
    .eq('profil_id', profilId)
    .maybeSingle();

  if (!data) return null;

  return {
    risqueMaxParTradePct: Number(data.risque_max_par_trade_pct),
    risqueTotalMaxPct: Number(data.risque_total_max_pct),
    positionsMax: data.positions_max,
    positionsCorreleesMax: data.positions_correlees_max,
    seuilCorrelation: Number(data.seuil_correlation),
    perteJournaliereMaxPct: Number(data.perte_journaliere_max_pct),
    drawdownMaxPct: Number(data.drawdown_max_pct),
    levierMax: Number(data.levier_max),
    fenetreEvenementMacroMinutes: data.fenetre_evenement_macro_minutes,
    stopLossObligatoire: data.stop_loss_obligatoire,
  };
}

export async function lancerCycle(options: OptionsCycle): Promise<ResultatCycle> {
  const { client, profilId, symbole, intervalle } = options;
  const echec = (message: string, cycleId: string | null = null): ResultatCycle => ({
    ok: false,
    cycleId,
    etatFinal: 'ECHOUE',
    message,
    coutUsd: 0,
    appels: 0,
  });

  // ═══ Barrière budgétaire, avant toute dépense ═══
  const budget = await etatBudget(client, profilId);
  if (!budgetSuffisant(budget)) {
    return echec(
      `Plafond de dépense quotidien atteint : ${budget.depenseUsd.toFixed(2)} $ US sur ${budget.plafondUsd.toFixed(2)} $ US. Les agents reprennent demain (UTC) ou après relèvement du plafond dans les Réglages.`,
    );
  }

  const [{ data: profil }, agents, parametres] = await Promise.all([
    client.from('profils').select('mode_operation').eq('id', profilId).maybeSingle(),
    chargerAgents(client, profilId),
    lireParametresRisque(client, profilId),
  ]);

  if (!profil) return echec('Profil introuvable.');
  if (!parametres) return echec('Paramètres de risque introuvables.');
  if (agents.length === 0) return echec('Aucun agent actif : le kill switch est peut-être enclenché.');

  const mode = profil.mode_operation;

  const instrumentCharge = await chargerInstrument(client, symbole);
  if (!instrumentCharge) return echec(`Instrument ${symbole} inconnu.`);

  const persiste = await chargerEtat(client, profilId, symbole);
  if (!persiste) return echec('Aucun portefeuille pour ce profil.');
  if (persiste.etat.portefeuille.gele) {
    return echec('Portefeuille gelé : aucun cycle ne peut être lancé.');
  }

  // ═══ COLLECTE_DONNEES ═══
  let marche;
  try {
    marche = await obtenirChandeliers({ client, profilId, symbole, intervalle, limite: 300 });
  } catch (erreur) {
    return echec(
      `Données de marché indisponibles : ${erreur instanceof Error ? erreur.message : 'erreur inconnue'}.`,
    );
  }

  const instantane = construireInstantane(
    instrumentCharge.instrument,
    intervalle,
    marche.chandeliers,
    {
      origine: marche.origine,
      fournisseur: marche.fournisseur,
      perime: marche.perime,
      retarde: marche.retarde,
    },
  );
  if (!instantane) return echec('Aucune bougie exploitable pour cet instrument.');

  const { data: cycle } = await client
    .from('cycles')
    .insert({
      profil_id: profilId,
      portefeuille_id: persiste.portefeuilleId,
      symbole_id: instrumentCharge.symboleId,
      intervalle,
      declencheur: options.declencheur ?? 'MANUEL',
      etat: 'COLLECTE_DONNEES',
      tours_debat: options.toursDebat ?? 2,
      budget_appels_llm: options.budgetAppels ?? 20,
      budget_secondes: options.budgetSecondes ?? 240,
      instantane_donnees: instantane as never,
    })
    .select('id, tours_debat, budget_appels_llm, budget_secondes')
    .maybeSingle();

  if (!cycle) return echec('Impossible d’ouvrir le cycle.');

  const compteur = new Compteur(cycle.budget_appels_llm, cycle.budget_secondes, budget);
  const sequence: Sequence = { valeur: 0 };
  const rendu = rendreInstantane(instantane);

  const contexteMock: ContexteDeterministe = {
    symbole: instantane.symbole,
    dernierPrix: instantane.dernierPrix,
    atr: instantane.indicateurs.atr14,
    decimales: instantane.decimales,
  };

  await messageSysteme(
    {
      client,
      profilId,
      cycleId: cycle.id,
      etat: 'COLLECTE_DONNEES',
      sequence: (sequence.valeur += 1),
      tour: 0,
    },
    [
      `Instantané constitué : ${instantane.chandeliers.length} bougies ${intervalle} sur ${symbole}, source ${instantane.fournisseur} (${instantane.origine}).`,
      instantane.perime ? 'Données périmées servies depuis le cache.' : '',
      instantane.retarde ? 'Le fournisseur annonce des données retardées.' : '',
      `Dernier prix : ${instantane.dernierPrix.toFixed(instantane.decimales)}.`,
    ]
      .filter(Boolean)
      .join(' '),
    { origine: instantane.origine, fournisseur: instantane.fournisseur },
  );

  // Mémoire : une seule requête sert tout le cycle. Les embeddings sont
  // facturés, en refaire un par agent serait du gaspillage pur.
  const requeteMemoire = [
    `${symbole} ${intervalle}`,
    `dernier prix ${instantane.dernierPrix}`,
    `RSI ${instantane.indicateurs.rsi14 ?? 'inconnu'}`,
    instantane.classeActif,
  ].join(' — ');

  const [lecons, strategiesGenerales] = await Promise.all([
    recupererLecons(client, profilId, requeteMemoire, instrumentCharge.symboleId, 3),
    recupererStrategies(client, profilId, requeteMemoire, null, 2),
  ]);

  const contexteCommun = {
    modeOperation: mode,
    lecons: lecons.map((lecon) => lecon.rendu),
  };

  /** Appel d'un agent avec journalisation du fil et respect des budgets. */
  const faireParler = async (
    agent: AgentCharge,
    etat: EtatCycle,
    tour: number,
    messages: readonly MessageLLM[],
    formatJson: string | null,
    strategies: readonly string[] = strategiesGenerales.map((extrait) => extrait.rendu),
  ): Promise<{ contenu: string; appel: ResultatAppel } | { erreur: string }> => {
    const blocage = compteur.obstacle();
    if (blocage) return { erreur: blocage };

    const messageId = await ouvrirMessage({
      client,
      profilId,
      cycleId: cycle.id,
      agentId: agent.id,
      etat,
      sequence: (sequence.valeur += 1),
      tour,
    });

    try {
      const appel = await appelerModele({
        client,
        profilId,
        cycleId: cycle.id,
        agent: {
          id: agent.id,
          fournisseur: agent.fournisseur,
          modele: agent.modele,
          temperature: agent.temperature,
          tokensMax: agent.tokensMax,
        },
        systeme: construireSysteme(
          { ...contexteCommun, mandat: agent.mandat, nomAgent: agent.nom, strategies },
          formatJson,
        ),
        messages,
        formatJson,
        contexteDeterministe: contexteMock,
      });

      compteur.enregistrer(appel);
      await completerMessage(client, messageId, appel.contenu, appel, {
        fournisseur: agent.fournisseur,
        modele: appel.modele,
        tronquee: appel.tronquee,
      });

      return { contenu: appel.contenu, appel };
    } catch (erreur) {
      const message =
        erreur instanceof ErreurLLM
          ? erreur.message
          : erreur instanceof Error
            ? erreur.message
            : 'Erreur inconnue.';
      await completerMessage(client, messageId, `⚠ Appel impossible : ${message}`, null, {
        echec: true,
      });
      return { erreur: message };
    }
  };

  const parRole = (role: RoleAgent): AgentCharge | undefined =>
    agents.find((agent) => agent.role === role);

  // ═══ ANALYSE ═══ (en parallèle : les analystes ne se lisent pas entre eux)
  await majEtatCycle(client, cycle.id, 'ANALYSE');

  const analystes = ROLES_ANALYSTES.map(parRole).filter(
    (agent): agent is AgentCharge => agent !== undefined,
  );

  const messageMarche: MessageLLM = {
    role: 'utilisateur',
    contenu: messageInstantane(instantane, rendu),
  };

  const rapports = await Promise.all(
    analystes.map(async (agent) => {
      const resultat = await faireParler(
        agent,
        'ANALYSE',
        0,
        [messageMarche],
        null,
        agent.familleStrategie
          ? (await recupererStrategies(client, profilId, requeteMemoire, agent.familleStrategie, 2)).map(
              (extrait) => extrait.rendu,
            )
          : strategiesGenerales.map((extrait) => extrait.rendu),
      );
      return { agent, resultat };
    }),
  );

  const rapportsReussis = rapports.filter(
    (entree): entree is { agent: AgentCharge; resultat: { contenu: string; appel: ResultatAppel } } =>
      'contenu' in entree.resultat,
  );

  if (rapportsReussis.length === 0) {
    const raison = rapports[0] && 'erreur' in rapports[0].resultat
      ? rapports[0].resultat.erreur
      : 'aucun analyste n’a répondu';
    await terminerEnEchec(client, cycle.id, raison);
    return {
      ok: false,
      cycleId: cycle.id,
      etatFinal: 'ECHOUE',
      message: `Cycle interrompu à l’analyse : ${raison}`,
      ...compteur.total,
      coutUsd: compteur.total.cout,
      appels: compteur.total.appels,
    };
  }

  await client.from('rapports_analyse').insert(
    rapportsReussis.map((entree) => ({
      profil_id: profilId,
      cycle_id: cycle.id,
      agent_id: entree.agent.id,
      role: entree.agent.role,
      contenu: entree.resultat.contenu,
      donnees: { modele: entree.resultat.appel.modele } as never,
    })),
  );

  const syntheseAnalyses = rapportsReussis
    .map((entree) => resumerPourSuite(entree.agent.nom, entree.resultat.contenu))
    .join('\n\n');

  // ═══ DÉBAT ═══
  await majEtatCycle(client, cycle.id, 'DEBAT');

  const haussier = parRole('CHERCHEUR_HAUSSIER');
  const baissier = parRole('CHERCHEUR_BAISSIER');
  const fil: string[] = [];

  for (let tour = 1; tour <= cycle.tours_debat; tour += 1) {
    for (const chercheur of [haussier, baissier]) {
      if (!chercheur) continue;
      const contexteDebat: MessageLLM[] = [
        { role: 'utilisateur', contenu: `RAPPORTS D’ANALYSE\n\n${syntheseAnalyses}` },
      ];
      if (fil.length > 0) {
        contexteDebat.push({
          role: 'utilisateur',
          contenu: `DÉBAT EN COURS (tour ${tour})\n\n${fil.slice(-2).join('\n\n')}`,
        });
      }

      const resultat = await faireParler(chercheur, 'DEBAT', tour, contexteDebat, null);
      if ('contenu' in resultat) {
        fil.push(resumerPourSuite(chercheur.nom, resultat.contenu, 900));
      }
    }
  }

  // ═══ SYNTHÈSE ═══
  await majEtatCycle(client, cycle.id, 'SYNTHESE');

  const directeur = parRole('DIRECTEUR_RECHERCHE');
  if (!directeur) {
    await terminerEnEchec(client, cycle.id, 'Directeur de recherche absent.');
    return finir(cycle.id, 'ECHOUE', 'Directeur de recherche absent.', compteur);
  }

  const resultatSynthese = await faireParler(
    directeur,
    'SYNTHESE',
    0,
    [
      { role: 'utilisateur', contenu: `RAPPORTS D’ANALYSE\n\n${syntheseAnalyses}` },
      {
        role: 'utilisateur',
        contenu:
          fil.length > 0
            ? `DÉBAT\n\n${fil.join('\n\n')}`
            : 'DÉBAT\n\nAucun débat exploitable : les chercheurs n’ont pas répondu.',
      },
    ],
    'vue_marche',
  );

  if ('erreur' in resultatSynthese) {
    await terminerEnEchec(client, cycle.id, resultatSynthese.erreur);
    return finir(cycle.id, 'ECHOUE', `Synthèse impossible : ${resultatSynthese.erreur}`, compteur);
  }

  const vue = analyser(schemaVueMarche, resultatSynthese.contenu);
  if (!vue.ok || !vue.valeur) {
    await terminerEnEchec(client, cycle.id, vue.erreur ?? 'Vue de marché illisible.');
    return finir(
      cycle.id,
      'ECHOUE',
      `Vue de marché illisible : ${vue.erreur ?? 'format inattendu'}`,
      compteur,
    );
  }

  await client.from('vues_marche').insert({
    profil_id: profilId,
    cycle_id: cycle.id,
    direction: vue.valeur.direction,
    conviction: vue.valeur.conviction,
    horizon: vue.valeur.horizon ?? null,
    niveau_invalidation: vue.valeur.niveau_invalidation ?? null,
    resume: vue.valeur.resume,
  });

  // ═══ PROPOSITION ═══
  await majEtatCycle(client, cycle.id, 'PROPOSITION');

  const trader = parRole('TRADER');
  if (!trader) {
    await terminerEnEchec(client, cycle.id, 'Trader absent.');
    return finir(cycle.id, 'ECHOUE', 'Trader absent.', compteur);
  }

  const resultatProposition = await faireParler(
    trader,
    'PROPOSITION',
    0,
    [
      messageMarche,
      {
        role: 'utilisateur',
        contenu: `VUE DE MARCHÉ\nDirection ${vue.valeur.direction}, conviction ${vue.valeur.conviction}/100.\n${vue.valeur.resume}`,
      },
      {
        role: 'utilisateur',
        contenu: messagePortefeuille(
          persiste.etat.portefeuille,
          persiste.etat.positions.length,
          persiste.etat.portefeuille.devise,
        ),
      },
    ],
    'proposition',
  );

  if ('erreur' in resultatProposition) {
    await terminerEnEchec(client, cycle.id, resultatProposition.erreur);
    return finir(
      cycle.id,
      'ECHOUE',
      `Proposition impossible : ${resultatProposition.erreur}`,
      compteur,
    );
  }

  const lecture = analyser(schemaProposition, resultatProposition.contenu);
  if (!lecture.ok || !lecture.valeur) {
    await terminerEnEchec(client, cycle.id, lecture.erreur ?? 'Proposition illisible.');
    return finir(
      cycle.id,
      'ECHOUE',
      `Proposition illisible : ${lecture.erreur ?? 'format inattendu'}`,
      compteur,
    );
  }

  if (lecture.valeur.action === 'ABSTENTION') {
    await messageSysteme(
      {
        client,
        profilId,
        cycleId: cycle.id,
        etat: 'JOURNALISATION',
        sequence: (sequence.valeur += 1),
        tour: 0,
      },
      `Aucun ordre proposé. ${lecture.valeur.raisonnement}`,
    );
    await terminer(client, cycle.id, compteur);
    return finir(cycle.id, 'TERMINE', 'Cycle terminé : les agents s’abstiennent.', compteur);
  }

  const proposition: Extract<Proposition, { action: 'ORDRE' }> = lecture.valeur;

  // ═══ Contrôle d'ancrage : dernier filet avant que le chiffre d'un modèle ne
  //     devienne un ordre. Les garde-fous vérifient la taille, pas la
  //     vraisemblance du niveau. ═══
  const ancrage = verifierAncrage(proposition, instantane);
  if (!ancrage.ok) {
    await messageSysteme(
      {
        client,
        profilId,
        cycleId: cycle.id,
        etat: 'CONTROLE_RISQUE',
        sequence: (sequence.valeur += 1),
        tour: 0,
      },
      `Proposition écartée avant tout contrôle de risque. ${ancrage.raison}`,
      { controle: 'ANCRAGE' },
    );
    await terminer(client, cycle.id, compteur);
    return finir(cycle.id, 'TERMINE', ancrage.raison, compteur);
  }

  // ═══ CONTRÔLE_RISQUE puis DÉCISION_PM ═══
  //
  // L'avis du gestionnaire de risque est un texte, pas une décision : c'est
  // `soumettreProposition` — donc `evaluerPermission` puis `evaluerGardeFous` —
  // qui tranche. On ne réimplémente pas ces barrières ici, sous peine d'avoir
  // deux chemins d'exécution qui divergent avec le temps.
  await majEtatCycle(client, cycle.id, 'CONTROLE_RISQUE');

  const gestionnaireRisque = parRole('GESTIONNAIRE_RISQUE');
  if (gestionnaireRisque) {
    await faireParler(
      gestionnaireRisque,
      'CONTROLE_RISQUE',
      0,
      [
        {
          role: 'utilisateur',
          contenu: `PROPOSITION DU TRADER\n${proposition.sens} ${proposition.quantite} lot(s) ${symbole}, entrée ${proposition.prix_entree ?? instantane.dernierPrix}, stop ${proposition.stop_loss}, cible ${proposition.take_profit ?? 'aucune'}.\nRaisonnement : ${proposition.raisonnement}`,
        },
        {
          role: 'utilisateur',
          contenu: messagePortefeuille(
            persiste.etat.portefeuille,
            persiste.etat.positions.length,
            persiste.etat.portefeuille.devise,
          ),
        },
      ],
      null,
    );
  }

  await majEtatCycle(client, cycle.id, 'DECISION_PM');

  const gestionnairePortefeuille = parRole('GESTIONNAIRE_PORTEFEUILLE');
  let justificationPm = 'Aucun gestionnaire de portefeuille actif : proposition transmise telle quelle.';

  if (gestionnairePortefeuille) {
    const resultatPm = await faireParler(
      gestionnairePortefeuille,
      'DECISION_PM',
      0,
      [
        {
          role: 'utilisateur',
          contenu: `VUE DE MARCHÉ\nDirection ${vue.valeur.direction}, conviction ${vue.valeur.conviction}/100.\n${vue.valeur.resume}`,
        },
        {
          role: 'utilisateur',
          contenu: `PROPOSITION\n${proposition.sens} ${proposition.quantite} lot(s) ${symbole}, entrée ${proposition.prix_entree ?? instantane.dernierPrix}, stop ${proposition.stop_loss}.\n${proposition.raisonnement}`,
        },
        {
          role: 'utilisateur',
          contenu:
            'La taille finale et le droit d’exécuter sont décidés par le serveur après toi. Tu ne peux que confirmer ou refuser ; tu ne peux pas augmenter la taille.',
        },
      ],
      'decision_pm',
    );

    if ('contenu' in resultatPm) {
      const lu = analyser(schemaDecisionPm, resultatPm.contenu);
      if (lu.ok && lu.valeur) {
        justificationPm = lu.valeur.justification;
        if (lu.valeur.decision === 'REFUSE') {
          await messageSysteme(
            {
              client,
              profilId,
              cycleId: cycle.id,
              etat: 'JOURNALISATION',
              sequence: (sequence.valeur += 1),
              tour: 0,
            },
            `Ordre non transmis. ${justificationPm}`,
          );
          await terminer(client, cycle.id, compteur);
          return finir(cycle.id, 'TERMINE', `Ordre non transmis. ${justificationPm}`, compteur);
        }
      } else {
        // Sortie illisible : on ne devine pas une approbation. Le doute
        // s'arbitre contre l'engagement de capital.
        const raison = `Décision du gestionnaire de portefeuille illisible (${lu.erreur ?? 'format inattendu'}) : traitée comme un refus.`;
        await messageSysteme(
          {
            client,
            profilId,
            cycleId: cycle.id,
            etat: 'JOURNALISATION',
            sequence: (sequence.valeur += 1),
            tour: 0,
          },
          raison,
        );
        await terminer(client, cycle.id, compteur);
        return finir(cycle.id, 'TERMINE', raison, compteur);
      }
    }
  }

  // ═══ EXÉCUTION : chemin unique, celui du banc d'essai et de l'orchestrateur ═══
  await majEtatCycle(client, cycle.id, 'EXECUTION');

  const executant = gestionnairePortefeuille ?? trader;
  const soumission = await soumettreProposition({
    agentCle: executant.cle,
    cycleId: cycle.id,
    symbole,
    intervalle,
    sens: proposition.sens,
    type: proposition.type_ordre,
    quantite: proposition.quantite,
    prixDemande: proposition.prix_entree ?? null,
    stopLoss: proposition.stop_loss,
    takeProfit: proposition.take_profit ?? null,
    raisonnement: `${proposition.raisonnement}\n\nDécision du gestionnaire de portefeuille : ${justificationPm}`,
    confiance: Math.round(vue.valeur.conviction),
  });

  await messageSysteme(
    {
      client,
      profilId,
      cycleId: cycle.id,
      etat: 'JOURNALISATION',
      sequence: (sequence.valeur += 1),
      tour: 0,
    },
    soumission.message,
    { verdict: soumission.verdict, controles: soumission.controles },
  );

  await client.from('journal_audit').insert({
    profil_id: profilId,
    acteur: 'agents',
    action: 'CYCLE_TERMINE',
    entite: 'cycles',
    entite_id: cycle.id,
    details: {
      symbole,
      intervalle,
      mode,
      direction: vue.valeur.direction,
      conviction: vue.valeur.conviction,
      verdict: soumission.verdict,
      cout_usd: compteur.total.cout,
    } as never,
  });

  await terminer(client, cycle.id, compteur);
  return finir(cycle.id, 'TERMINE', soumission.message, compteur);
}

async function terminer(client: Client, cycleId: string, compteur: Compteur): Promise<void> {
  await majEtatCycle(client, cycleId, 'TERMINE', {
    termine_le: new Date().toISOString(),
    cout_usd: compteur.total.cout,
    appels_llm_utilises: compteur.total.appels,
  });
}

async function terminerEnEchec(client: Client, cycleId: string, raison: string): Promise<void> {
  await majEtatCycle(client, cycleId, 'ECHOUE', {
    termine_le: new Date().toISOString(),
    erreur: raison.slice(0, 500),
  });
}

function finir(
  cycleId: string,
  etatFinal: EtatCycle,
  message: string,
  compteur: Compteur,
  propositionId: string | null = null,
): ResultatCycle {
  return {
    ok: etatFinal === 'TERMINE',
    cycleId,
    etatFinal,
    message,
    propositionId,
    coutUsd: compteur.total.cout,
    appels: compteur.total.appels,
  };
}
