import { TIMEFRAME_SECONDS, type Timeframe } from '@/types/market';
import type { Bar } from '@/types/market';

/**
 * Générateur déterministe de bougies pour les tests.
 *
 * Déterministe et non aléatoire : un test qui échoue une fois sur vingt sur des
 * données tirées au sort finit par être ignoré, et c'est précisément le jour où
 * il attrape quelque chose qu'on le désactive.
 *
 * La série alterne des tendances assez marquées pour que deux moyennes mobiles
 * se croisent plusieurs fois — sans quoi un test sur le moteur ne prouverait
 * que sa capacité à ne rien faire.
 */

/** Congruentiel linéaire. Suffisant pour du bruit reproductible. */
function generateur(graine: number): () => number {
  let etat = (graine * 1_664_525 + 1_013_904_223) >>> 0;
  return () => {
    etat = (etat * 1_664_525 + 1_013_904_223) >>> 0;
    return etat / 0xffff_ffff;
  };
}

export function serieSynthetique(
  nombre: number,
  graine = 42,
  timeframe: Timeframe = '1h',
  depart = 1_700_000_000,
): readonly Bar[] {
  const pas = TIMEFRAME_SECONDS[timeframe];
  // Ouverture alignée sur le pas : une bougie horaire à 10 h 03 serait rejetée
  // par le normalizer, et le moteur travaille sur des séries normalisées.
  const origine = Math.floor(depart / pas) * pas;
  const alea = generateur(graine);

  const bars: Bar[] = [];
  let prix = 100;

  for (let i = 0; i < nombre; i += 1) {
    // Cycle lent + bruit : les croisements arrivent, mais pas à chaque bougie.
    const tendance = Math.sin((i / 40) * Math.PI * 2) * 0.4;
    const bruit = (alea() - 0.5) * 0.6;
    const ouverture = prix;
    const cloture = Math.max(1, ouverture + tendance + bruit);
    const amplitude = Math.abs(cloture - ouverture) + 0.2 + alea() * 0.3;

    bars.push({
      time: origine + i * pas,
      open: arrondir(ouverture),
      high: arrondir(Math.max(ouverture, cloture) + amplitude / 2),
      low: arrondir(Math.max(0.5, Math.min(ouverture, cloture) - amplitude / 2)),
      close: arrondir(cloture),
      volume: Math.round(1_000 + alea() * 500),
    });
    prix = cloture;
  }

  return bars;
}

function arrondir(valeur: number): number {
  return Math.round(valeur * 100) / 100;
}
