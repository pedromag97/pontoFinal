-- Migração: marcar como vistas as picagens tentadas e não concluídas.
--
-- O painel em Registos mostra as tentativas que nunca deram registo. Sem
-- forma de as arrumar, a lista só cresce: o aviso do mês passado, já
-- tratado, fica a competir com o de hoje e deixa de se dar por ele.
--
-- Marcar como vista não apaga nada — guarda quem arrumou e quando, e as
-- vistas continuam a poder ser consultadas.

alter table public.punch_challenges
  add column if not exists dismissed_at timestamptz,
  add column if not exists dismissed_by uuid
    references public.profiles (id) on delete set null;

comment on column public.punch_challenges.dismissed_at is
  'Quando a gestão marcou esta tentativa falhada como vista.';

-- Lista do painel: tentativas por usar, já expiradas e por arrumar.
create index if not exists punch_challenges_perdidas_idx
  on public.punch_challenges (created_at desc)
  where used_at is null and dismissed_at is null;
