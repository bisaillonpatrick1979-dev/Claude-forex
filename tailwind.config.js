/**
 * Palette imposée par la direction visuelle : terminal professionnel sombre.
 * Le vert et le rouge sont réservés au résultat financier — aucun autre
 * élément d'interface n'a le droit de les utiliser, sinon un chiffre négatif
 * cesse d'être repérable d'un coup d'œil au milieu d'un écran dense.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        fond: '#0A0E17',
        surface: '#131A26',
        bordure: '#1F2937',
        texte: '#E5E7EB',
        'texte-doux': '#94A3B8',
        hausse: '#26A69A',
        baisse: '#EF5350',
        accent: '#3B82F6',
        alerte: '#F59E0B',
        danger: '#DC2626',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      spacing: {
        // Cible tactile minimale recommandée : 44 px. Nommée pour qu'on ne
        // puisse pas la réduire par distraction dans un composant.
        tactile: '44px',
      },
    },
  },
  plugins: [],
};
