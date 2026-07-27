import { describe, expect, it } from 'vitest';

import {
  CHAMPS_LIMITES,
  repartirParTable,
  validerLimites,
  type CleLimite,
  type ValeursLimites,
} from '@/lib/config/limites';
import { RISQUE_DEFAUTS } from '@/lib/config/risque-defauts';

/**
 * Les limites deviennent éditables depuis l'application : la validation cesse
 * d'être décorative. Ces tests couvrent ce qu'un formulaire produit vraiment —
 * des chaînes, parfois vides — et pas seulement des nombres bien formés.
 */

const VALIDES: ValeursLimites = {
  risqueMaxParTradePct: 1,
  risqueTotalMaxPct: 5,
  positionsMax: 5,
  partPositionMaxPct: 50,
  partFacteurMaxPct: 50,
  perteJournaliereMaxPct: 3,
  drawdownMaxPct: 15,
  levierMax: 10,
  fenetreEvenementMacroMinutes: 30,
  plafondCoutQuotidienUsd: 5,
};

function avec(surcharge: Partial<Record<CleLimite, unknown>>) {
  return validerLimites({ ...VALIDES, ...surcharge });
}

describe('validation des limites', () => {
  it('accepte le jeu par défaut', () => {
    expect(avec({}).ok).toBe(true);
  });

  it('accepte les chaînes que produit un formulaire', () => {
    expect(avec({ risqueTotalMaxPct: '7.5', plafondCoutQuotidienUsd: '25' }).ok).toBe(true);
  });

  it('refuse un champ vidé plutôt que de le lire comme zéro', () => {
    // `Number('')` vaut zéro. Sur la fenêtre macro, qui autorise zéro, un champ
    // effacé désactiverait le contrôle sans que rien ne le dise.
    const resultat = avec({ fenetreEvenementMacroMinutes: '' });
    expect(resultat.ok).toBe(false);
    expect(resultat.erreurs.fenetreEvenementMacroMinutes).toMatch(/manquante/);

    // Un zéro explicite, lui, reste un choix légitime.
    expect(avec({ fenetreEvenementMacroMinutes: 0 }).ok).toBe(true);
  });

  it('refuse les espaces et le texte', () => {
    expect(avec({ levierMax: '   ' }).ok).toBe(false);
    expect(avec({ levierMax: 'beaucoup' }).ok).toBe(false);
  });

  it('refuse hors des bornes, des deux côtés', () => {
    expect(avec({ levierMax: 31 }).erreurs.levierMax).toMatch(/entre 1 et 30/);
    expect(avec({ levierMax: 0 }).erreurs.levierMax).toBeDefined();
    // Le risque total est remonté avec : à 10 % par trade contre 5 % au total,
    // c'est la règle de cohérence qui refuserait, pas la borne qu'on teste.
    expect(avec({ risqueMaxParTradePct: 10, risqueTotalMaxPct: 20 }).ok).toBe(true);
    expect(avec({ risqueMaxParTradePct: 10.01, risqueTotalMaxPct: 20 }).ok).toBe(false);
  });

  it('laisse relever le budget IA bien au-dessus de cinq dollars', () => {
    // C'est la demande d'origine : le plafond est un réglage, pas une constante.
    expect(avec({ plafondCoutQuotidienUsd: 50 }).ok).toBe(true);
    expect(avec({ plafondCoutQuotidienUsd: 1000 }).ok).toBe(true);
    expect(avec({ plafondCoutQuotidienUsd: 1001 }).ok).toBe(false);
    // Zéro est légitime : c'est la façon d'arrêter toute dépense sans
    // désactiver les agents un par un.
    expect(avec({ plafondCoutQuotidienUsd: 0 }).ok).toBe(true);
  });

  it('refuse un risque par trade supérieur au risque total', () => {
    // Chacun est dans ses bornes, mais le couple rend le plafond par trade
    // inatteignable : le budget agrégé mordrait toujours avant.
    const resultat = avec({ risqueMaxParTradePct: 8, risqueTotalMaxPct: 5 });
    expect(resultat.ok).toBe(false);
    expect(resultat.erreurs.risqueMaxParTradePct).toBeUndefined();
    expect(resultat.incoherences).toHaveLength(1);
    expect(resultat.incoherences[0]).toMatch(/jamais être atteint/);
  });

  it('refuse une perte journalière supérieure au drawdown maximal', () => {
    const resultat = avec({ perteJournaliereMaxPct: 20, drawdownMaxPct: 15 });
    expect(resultat.ok).toBe(false);
    expect(resultat.incoherences[0]).toMatch(/ne servirait jamais/);
  });

  it('n’invente pas d’incohérence quand un champ est déjà refusé', () => {
    // Comparer une valeur hors bornes à une valeur saine produirait un second
    // message contradictoire pour une seule faute de saisie.
    const resultat = avec({ risqueMaxParTradePct: 999 });
    expect(resultat.erreurs.risqueMaxParTradePct).toBeDefined();
    expect(resultat.incoherences).toHaveLength(0);
  });
});

describe('répartition par table', () => {
  it('envoie chaque valeur dans la bonne colonne', () => {
    const { parametresRisque, profils } = repartirParTable(VALIDES);

    expect(parametresRisque.risque_total_max_pct).toBe(5);
    expect(parametresRisque.part_facteur_max_pct).toBe(50);
    expect(profils.plafond_cout_quotidien_usd).toBe(5);
    // Le budget IA ne doit pas fuir dans la table de risque, ni l'inverse.
    expect('plafond_cout_quotidien_usd' in parametresRisque).toBe(false);
    expect('risque_total_max_pct' in profils).toBe(false);
  });

  it('couvre chaque champ déclaré, sans doublon de colonne', () => {
    const { parametresRisque, profils } = repartirParTable(VALIDES);
    const total = Object.keys(parametresRisque).length + Object.keys(profils).length;
    expect(total).toBe(CHAMPS_LIMITES.length);
  });
});

describe('cohérence avec les valeurs par défaut', () => {
  it('accepte les défauts appliqués à la création d’un profil', () => {
    // Si les bornes du formulaire refusaient les valeurs posées par la
    // migration d'amorçage, le premier profil ouvrirait sur un formulaire déjà
    // en erreur.
    const resultat = validerLimites({
      risqueMaxParTradePct: RISQUE_DEFAUTS.risqueMaxParTradePct,
      risqueTotalMaxPct: RISQUE_DEFAUTS.risqueTotalMaxPct,
      positionsMax: RISQUE_DEFAUTS.positionsMax,
      partPositionMaxPct: RISQUE_DEFAUTS.partPositionMaxPct,
      partFacteurMaxPct: RISQUE_DEFAUTS.partFacteurMaxPct,
      perteJournaliereMaxPct: RISQUE_DEFAUTS.perteJournaliereMaxPct,
      drawdownMaxPct: RISQUE_DEFAUTS.drawdownMaxPct,
      levierMax: RISQUE_DEFAUTS.levierMax,
      fenetreEvenementMacroMinutes: RISQUE_DEFAUTS.fenetreEvenementMacroMinutes,
      plafondCoutQuotidienUsd: 5,
    });

    expect(resultat.ok).toBe(true);
  });

  it('déclare des bornes cohérentes entre elles', () => {
    for (const champ of CHAMPS_LIMITES) {
      expect(champ.min).toBeLessThan(champ.max);
      expect(champ.pas).toBeGreaterThan(0);
      expect(champ.aide.length).toBeGreaterThan(10);
    }
  });
});
