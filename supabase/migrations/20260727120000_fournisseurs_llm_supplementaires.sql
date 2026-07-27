-- DeepSeek et Mistral rejoignent les fournisseurs de modèles.
--
-- Les deux exposent une API compatible avec le format d'OpenAI (mêmes routes,
-- mêmes champs), ce qui permet de partager l'adaptateur plutôt que d'en écrire
-- deux quasi identiques. L'URL de base et la grille tarifaire diffèrent, le
-- reste non.
--
-- L'ordre de l'énumération n'a aucune importance fonctionnelle, mais PostgreSQL
-- interdit de retirer une valeur : on n'ajoute donc que ce qui est réellement
-- implémenté et testé, pas une liste d'intentions.

alter type public.fournisseur_llm add value if not exists 'deepseek';
alter type public.fournisseur_llm add value if not exists 'mistral';
