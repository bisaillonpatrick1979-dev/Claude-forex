import { ShieldAlert } from 'lucide-react';

import { useLang, useT } from '@/i18n';

/**
 * En-tête permanent.
 *
 * Il porte deux choses qui ne doivent jamais quitter l'écran : la mention de
 * simulation, et le bouton PANIC. La mention parce qu'un utilisateur qui
 * oublie qu'il regarde de l'argent fictif tirera de fausses conclusions ; le
 * bouton parce qu'un coupe-circuit qu'il faut chercher n'est pas un
 * coupe-circuit.
 *
 * Le bouton PANIC est câblé en phase 7 : ici il annonce ce qu'il fera, et ne
 * prétend pas agir.
 */
export function TopBar({ onPanic }: { onPanic?: () => void }) {
  const t = useT();
  const [lang, setLang] = useLang();

  return (
    <header className="safe-haut sticky top-0 z-20 shrink-0 border-b border-bordure bg-surface">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="chiffre text-sm font-semibold tracking-tight">{t.app.name}</span>

        <button
          type="button"
          onClick={() => setLang(lang === 'en' ? 'fr' : 'en')}
          aria-label={t.settings.language}
          className="ml-auto min-h-tactile min-w-tactile rounded border border-bordure px-2 text-xs uppercase text-texte-doux active:text-texte"
        >
          {lang === 'en' ? 'FR' : 'EN'}
        </button>

        <button
          type="button"
          onClick={onPanic}
          disabled={!onPanic}
          title={t.risk.panicHint}
          className="flex min-h-tactile items-center gap-1.5 rounded bg-danger px-3 text-xs font-bold uppercase tracking-wider text-white disabled:opacity-40"
        >
          <ShieldAlert size={16} aria-hidden />
          {t.risk.panic}
        </button>
      </div>

      {/* Bandeau permanent, jamais masquable. */}
      <p className="bg-alerte/10 px-3 py-1 text-center text-[11px] text-alerte">
        {t.app.simulationBanner}
      </p>
    </header>
  );
}
