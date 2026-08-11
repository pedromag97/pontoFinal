-- Migração: lembretes push (esquecimento de volta do almoço / saída).
-- Parte 1: tabelas — correr tal e qual.
-- Parte 2: agendamento pg_cron — substituir <CRON_SECRET> pelo valor real
--          (o mesmo que está nas variáveis de ambiente da Vercel).

-- ------------------------------------------------------------
-- 1. TABELAS
-- ------------------------------------------------------------

-- Subscrições de notificações push (uma por dispositivo).
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_own" on public.push_subscriptions;
create policy "push_own"
  on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Lembretes já enviados (máx. 1 por funcionário/dia/tipo).
create table if not exists public.reminders_sent (
  employee_id uuid not null references public.profiles (id) on delete cascade,
  entry_date date not null,
  kind text not null,
  sent_at timestamptz not null default now(),
  primary key (employee_id, entry_date, kind)
);

-- Só o servidor (service role) escreve/lê — sem políticas para authenticated.
alter table public.reminders_sent enable row level security;

-- ------------------------------------------------------------
-- 2. AGENDAMENTO (pg_cron chama a app de 15 em 15 minutos)
--    ⚠️ Substituir <CRON_SECRET> antes de correr.
-- ------------------------------------------------------------

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('ponto-reminders')
where exists (select 1 from cron.job where jobname = 'ponto-reminders');

select cron.schedule(
  'ponto-reminders',
  '*/15 * * * *',
  $$
  select net.http_get(
    url := 'https://ponto.lusocabo.com/api/cron/reminders',
    headers := '{"Authorization": "Bearer <CRON_SECRET>"}'::jsonb
  );
  $$
);
