-- Migração: registos de almoço + horário por dia da semana.
-- Correr no SQL Editor se a base de dados já existia antes desta versão
-- (instalações novas já incluem isto no schema.sql).

-- 1. Novos tipos de registo: saida_almoco e volta_almoco.
alter table public.time_entries
  drop constraint if exists time_entries_entry_type_check;
alter table public.time_entries
  add constraint time_entries_entry_type_check
  check (entry_type in ('entrada', 'saida_almoco', 'volta_almoco', 'saida'));

-- 2. Horário de almoço por dia da semana (0 = domingo … 6 = sábado).
create table if not exists public.lunch_schedule (
  weekday int primary key check (weekday between 0 and 6),
  lunch_required boolean not null default false
);

insert into public.lunch_schedule (weekday, lunch_required)
values (0, false), (1, false), (2, false), (3, false),
       (4, false), (5, false), (6, false)
on conflict (weekday) do nothing;

alter table public.lunch_schedule enable row level security;

drop policy if exists "lunch_select_all" on public.lunch_schedule;
create policy "lunch_select_all"
  on public.lunch_schedule for select to authenticated
  using (true);

drop policy if exists "lunch_update_admin" on public.lunch_schedule;
create policy "lunch_update_admin"
  on public.lunch_schedule for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());
