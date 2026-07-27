import type { ClientAdmin } from '@/lib/execution/contexte-serveur';

import { FUSEAU_DEFAUT, jourLocal } from './journee';

/**
 * Ce qui manquait pour que « perte journalière » veuille dire quelque chose.
 *
 * Le garde-fou compare l'équité courante à `equiteDebutJournee`. Les deux
 * appelants lui passaient l'équité **courante** : la perte calculée valait donc
 * toujours zéro, et le plafond de perte journalière — réglable, affiché,
 * documenté — ne pouvait pas se déclencher. Un contrôle qui ne refuse jamais
 * est pire qu'un contrôle absent : on compte dessus.
 *
 * La table `instantanes_portefeuille` existait déjà, avec sa contrainte
 * d'unicité `(portefeuille_id, jour)`, mais rien ne l'écrivait. On s'en sert
 * comme repère d'ouverture : la première évaluation de la journée locale y
 * dépose l'équité du moment, toutes les suivantes la relisent.
 *
 * Approximation assumée, et il faut la dire : le repère est l'équité à la
 * **première évaluation** du jour, pas celle de minuit pile. Si la firme
 * n'évalue rien avant 10 h, un mouvement survenu à 9 h n'entre pas dans la
 * perte du jour. C'est structurel — personne ne mesure le portefeuille quand
 * personne ne le regarde — et ça reste très au-dessus d'un compteur qui vaut
 * zéro par construction.
 */
export async function equiteOuvertureJournee(
  client: ClientAdmin,
  parametres: {
    profilId: string;
    portefeuilleId: string;
    equiteActuelle: number;
    soldeActuel: number;
    fuseau?: string;
    maintenant?: Date;
  },
): Promise<number> {
  const jour = jourLocal(parametres.fuseau ?? FUSEAU_DEFAUT, parametres.maintenant ?? new Date());

  // `ignoreDuplicates` fait porter l'unicité par la base plutôt que par une
  // lecture suivie d'une écriture : deux évaluations simultanées au premier
  // ordre du jour ne peuvent pas créer deux repères différents.
  await client.from('instantanes_portefeuille').upsert(
    {
      profil_id: parametres.profilId,
      portefeuille_id: parametres.portefeuilleId,
      jour,
      equite: parametres.equiteActuelle,
      solde: parametres.soldeActuel,
    },
    { onConflict: 'portefeuille_id,jour', ignoreDuplicates: true },
  );

  const { data } = await client
    .from('instantanes_portefeuille')
    .select('equite')
    .eq('portefeuille_id', parametres.portefeuilleId)
    .eq('jour', jour)
    .maybeSingle();

  // Si l'écriture et la relecture échouent toutes deux, on rend l'équité
  // courante : la perte calculée vaut alors zéro, ce qui laisse passer. C'est
  // le comportement d'avant, donc une panne de repère ne bloque pas la firme —
  // mais les autres garde-fous, eux, restent en place.
  return data ? Number(data.equite) : parametres.equiteActuelle;
}

/** Fuseau déclaré par le profil, replié sur l'UTC s'il est absent. */
export async function lireFuseauProfil(
  client: ClientAdmin,
  profilId: string,
): Promise<string> {
  const { data } = await client
    .from('profils')
    .select('fuseau_horaire')
    .eq('id', profilId)
    .maybeSingle();

  return data?.fuseau_horaire ?? FUSEAU_DEFAUT;
}
