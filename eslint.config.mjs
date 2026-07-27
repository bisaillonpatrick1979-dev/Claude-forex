import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      /*
       * Un `const` lu avant sa déclaration ne casse pas la compilation quand
       * la lecture a lieu dans une closure — une fonction fléchée passée à
       * `map`, par exemple. TypeScript laisse passer, et l'erreur ne sort
       * qu'à l'exécution, en production, sous la forme illisible
       * « Cannot access 'G' before initialization ».
       *
       * C'est exactement ce qui a mis la salle des marchés hors service.
       * La règle rend la faute visible au lint plutôt qu'aux utilisateurs.
       */
      "@typescript-eslint/no-use-before-define": [
        "error",
        { functions: false, classes: true, variables: true, typedefs: false },
      ],
    },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // Runtime Deno : ni les globales ni les imports `jsr:` ne sont
      // résolubles par la configuration Next.
      "supabase/functions/**",
    ],
  },
];

export default eslintConfig;
