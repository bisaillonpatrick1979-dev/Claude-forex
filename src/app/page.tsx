import { redirect } from 'next/navigation';

/** La racine n'a pas de contenu propre : le point d'entrée est la salle des marchés. */
export default function Accueil() {
  redirect('/salle-des-marches');
}
