import type { ClientAdmin } from '@/lib/execution/contexte-serveur';

import { calculerEnveloppe, type EnveloppeAgents } from './enveloppe';

/**
 * Lecture de l'enveloppe des agents.
 *
 * Les profits et les pertes sont comptés séparément, pas nets : l'utilisateur
 * a demandé à voir « une cellule avec les profits, une cellule avec les
 * pertes ». Un net de +200 peut cacher +5 000 et −4 800, ce qui ne raconte pas
 * du tout la même histoire.
 *
 * Le latent est calculé à partir du dernier prix connu par le moteur, pas d'un
 * appel de marché : cette fonction est appelée à chaque rendu de la salle des
 * marchés, un appel réseau par affichage épuiserait le quota du fournisseur.
 */
export async function chargerEnveloppe(
  client: ClientAdmin,
  profilId: string,
): Promise<EnveloppeAgents> {
  const [{ data: portefeuille }, { data: fermees }, { data: ouvertes }] = await Promise.all([
    client
      .from('portefeuilles')
      .select('capital_alloue_agents')
      .eq('profil_id', profilId)
      .limit(1)
      .maybeSingle(),
    client
      .from('positions')
      .select('pnl_realise')
      .eq('profil_id', profilId)
      .eq('origine', 'AGENT')
      .in('statut', ['FERMEE', 'LIQUIDEE']),
    client
      .from('positions')
      .select('pnl_latent, marge_immobilisee')
      .eq('profil_id', profilId)
      .eq('origine', 'AGENT')
      .eq('statut', 'OUVERTE'),
  ]);

  let profitsRealises = 0;
  let pertesRealisees = 0;

  for (const ligne of fermees ?? []) {
    const montant = Number(ligne.pnl_realise ?? 0);
    if (montant >= 0) profitsRealises += montant;
    else pertesRealisees += -montant;
  }

  const latent = (ouvertes ?? []).reduce(
    (total, ligne) => total + Number(ligne.pnl_latent ?? 0),
    0,
  );
  const margeEngagee = (ouvertes ?? []).reduce(
    (total, ligne) => total + Number(ligne.marge_immobilisee ?? 0),
    0,
  );

  return calculerEnveloppe({
    alloue: Number(portefeuille?.capital_alloue_agents ?? 0),
    profitsRealises,
    pertesRealisees,
    latent,
    margeEngagee,
  });
}
