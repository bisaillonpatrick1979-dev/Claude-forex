-- Diffusion temps réel vers la salle des marchés.
-- Seules les tables réellement observées par l'UI sont publiées : chaque table
-- ajoutée à la publication a un coût en WAL sur le palier gratuit.
--
-- replica identity full est nécessaire pour que les UPDATE transmettent les
-- anciennes valeurs, sans quoi le client ne peut pas réconcilier une ligne
-- déjà en mémoire (cas du message qui se remplit token par token).

alter publication supabase_realtime add table public.messages_agents;
alter publication supabase_realtime add table public.cycles;
alter publication supabase_realtime add table public.propositions_ordres;
alter publication supabase_realtime add table public.ordres;
alter publication supabase_realtime add table public.positions;
alter publication supabase_realtime add table public.portefeuilles;

alter table public.messages_agents replica identity full;
alter table public.cycles replica identity full;
alter table public.propositions_ordres replica identity full;
alter table public.ordres replica identity full;
alter table public.positions replica identity full;
alter table public.portefeuilles replica identity full;
