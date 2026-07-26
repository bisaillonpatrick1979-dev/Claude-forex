import { deconnexion } from '@/app/connexion/actions';
import { MODES_AUTORISES, modeReelAutorise, type ModeOperation } from '@/lib/config/drapeaux';
import { AVERTISSEMENT_RISQUE } from '@/lib/config/modes';

import { KillSwitch } from './kill-switch';
import { SelecteurMode } from './selecteur-mode';

/**
 * Barre supérieure présente sur toutes les pages : identité, mode d'opération,
 * kill switch et avertissement permanent. L'avertissement n'est jamais
 * refermable — c'est le point.
 */
export function BarreSuperieure({
  courriel,
  mode,
  gele,
}: {
  courriel: string;
  mode: ModeOperation;
  gele: boolean;
}) {
  const modesAutorises: readonly ModeOperation[] = modeReelAutorise()
    ? [...MODES_AUTORISES, 'REEL_VALIDATION']
    : MODES_AUTORISES;

  return (
    <header className="shrink-0 border-b border-bordure bg-panneau">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2">
        <div className="flex items-baseline gap-2">
          <span className="chiffre text-[11px] uppercase tracking-[0.2em] text-texte-attenue">
            Trading Floor
          </span>
          <span className="text-sm font-semibold">IA</span>
        </div>

        <div className="order-3 w-full sm:order-none sm:w-auto">
          <SelecteurMode modeCourant={mode} modesAutorises={modesAutorises} />
        </div>

        <div className="ml-auto flex items-center gap-3">
          <KillSwitch gele={gele} />
          <span className="hidden text-[11px] text-texte-attenue md:inline">{courriel}</span>
          <form action={deconnexion}>
            <button
              type="submit"
              className="text-[11px] text-texte-attenue underline-offset-4 hover:underline"
            >
              Quitter
            </button>
          </form>
        </div>
      </div>

      <p className="border-t border-bordure px-3 py-1 text-[11px] text-texte-attenue">
        {AVERTISSEMENT_RISQUE}
      </p>
    </header>
  );
}
