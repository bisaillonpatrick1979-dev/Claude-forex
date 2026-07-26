-- Troisième mode : les agents analysent et conseillent, mais ne soumettent
-- aucun ordre. C'est moi qui trade, eux qui argumentent.
-- ALTER TYPE ... ADD VALUE doit être seul dans sa migration : la nouvelle
-- valeur n'est pas utilisable dans la transaction qui la crée.
alter type public.mode_operation add value if not exists 'PAPIER_CONSEIL' after 'PAPIER_VALIDATION';
