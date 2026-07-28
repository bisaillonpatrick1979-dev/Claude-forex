import { useT, useLangStore } from '@/i18n';
import { formatMoney } from '@/lib/format';
import { configWarnings, deriveLimits } from '@/lib/portfolioMath';
import { usePortfolioStore } from '@/store/portfolioStore';

/**
 * Traduction des réglages en conséquences.
 *
 * Un pourcentage ne dit rien : « 2 % » ne devient parlant qu'affiché en
 * dollars, à côté du capital sur lequel il porte. Ce panneau existe pour que
 * personne ne découvre le plafond réel au moment où une position est refusée.
 */
export function DerivedLimitsCard() {
  const t = useT();
  const lang = useLangStore((etat) => etat.lang);
  const config = usePortfolioStore((etat) => etat.config);

  const limites = deriveLimits(config);
  const avertissements = configWarnings(config);
  const devise = config.currency;

  const lignes: readonly { label: string; value: string }[] = [
    { label: t.config.aiCapital, value: formatMoney(limites.aiCapital.versNombre(), devise, lang) },
    {
      label: t.config.effectiveMaxTrade,
      value: formatMoney(limites.maxTradeValue.versNombre(), devise, lang),
    },
    {
      label: t.config.dailyLossLimit,
      value: formatMoney(limites.dailyLossLimit.versNombre(), devise, lang),
    },
    {
      label: t.config.drawdownLimit,
      value: formatMoney(limites.drawdownLimit.versNombre(), devise, lang),
    },
    {
      label: t.config.roundTripCost,
      value: formatMoney(limites.roundTripCost.versNombre(), devise, lang),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <dl className="flex flex-col gap-2">
        {lignes.map((ligne) => (
          <div key={ligne.label} className="flex items-baseline justify-between gap-3">
            <dt className="text-xs text-texte-doux">{ligne.label}</dt>
            <dd className="chiffre text-sm">{ligne.value}</dd>
          </div>
        ))}
      </dl>

      {avertissements.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {avertissements.map((code) => (
            <li
              key={code}
              className="rounded border border-alerte/40 bg-alerte/10 px-2.5 py-1.5 text-xs text-alerte"
            >
              {t.warn[code]}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
