import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Chiffrement des clés API stockées en base.
 *
 * AES-256-GCM : authentifié, donc une valeur altérée en base est détectée au
 * déchiffrement au lieu de produire une clé silencieusement fausse.
 *
 * La clé maîtresse vient de CLE_CHIFFREMENT (32 octets en base64). Elle n'est
 * jamais en base : compromettre la base ne suffit donc pas à lire les clés API.
 *
 * Format stocké : v1.<iv base64>.<tag base64>.<chiffré base64>
 * Le préfixe de version permettra une rotation d'algorithme sans deviner.
 */

const VERSION = 'v1';
const TAILLE_IV = 12; // recommandation GCM
const TAILLE_CLE = 32;

function cleMaitresse(): Buffer {
  const brute = process.env.CLE_CHIFFREMENT;
  if (!brute) {
    throw new Error(
      'CLE_CHIFFREMENT absente : impossible de chiffrer ou déchiffrer une clé API. ' +
        'Générer une valeur avec « openssl rand -base64 32 ».',
    );
  }
  const cle = Buffer.from(brute, 'base64');
  if (cle.length !== TAILLE_CLE) {
    throw new Error(
      `CLE_CHIFFREMENT invalide : ${cle.length} octets après décodage base64, ${TAILLE_CLE} attendus.`,
    );
  }
  return cle;
}

export function chiffrer(valeurClaire: string): string {
  const iv = randomBytes(TAILLE_IV);
  const chiffreur = createCipheriv('aes-256-gcm', cleMaitresse(), iv);
  const chiffre = Buffer.concat([chiffreur.update(valeurClaire, 'utf8'), chiffreur.final()]);
  const tag = chiffreur.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), chiffre.toString('base64')].join(
    '.',
  );
}

export function dechiffrer(valeurStockee: string): string {
  const morceaux = valeurStockee.split('.');
  if (morceaux.length !== 4 || morceaux[0] !== VERSION) {
    throw new Error('Format de clé chiffrée non reconnu.');
  }

  const [, ivBase64, tagBase64, chiffreBase64] = morceaux;
  const dechiffreur = createDecipheriv(
    'aes-256-gcm',
    cleMaitresse(),
    Buffer.from(ivBase64 ?? '', 'base64'),
  );
  dechiffreur.setAuthTag(Buffer.from(tagBase64 ?? '', 'base64'));

  return Buffer.concat([
    dechiffreur.update(Buffer.from(chiffreBase64 ?? '', 'base64')),
    dechiffreur.final(),
  ]).toString('utf8');
}

/** Ce que l'UI a le droit d'afficher : les quatre derniers caractères. */
export function indiceVisuel(valeurClaire: string): string {
  const fin = valeurClaire.slice(-4);
  return fin.length === 4 ? `••••${fin}` : '••••';
}

/** Vrai si le chiffrement est utilisable — pour afficher un message clair
 *  dans les Réglages au lieu de laisser une exception remonter. */
export function chiffrementConfigure(): boolean {
  try {
    cleMaitresse();
    return true;
  } catch {
    return false;
  }
}
