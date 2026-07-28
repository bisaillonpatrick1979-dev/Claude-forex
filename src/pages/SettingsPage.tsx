import { Panel } from '@/components/ui/Panel';
import { useLang, useT } from '@/i18n';

export function SettingsPage() {
  const t = useT();
  const [lang, setLang] = useLang();

  return (
    <div className="flex flex-col gap-3">
      <Panel title={t.settings.title}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm">{t.settings.language}</span>
          <div className="flex gap-1">
            {(['en', 'fr'] as const).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLang(code)}
                className={[
                  'min-h-tactile min-w-tactile rounded border px-3 text-xs uppercase',
                  lang === code
                    ? 'border-accent text-accent'
                    : 'border-bordure text-texte-doux',
                ].join(' ')}
              >
                {code}
              </button>
            ))}
          </div>
        </div>
      </Panel>
    </div>
  );
}
