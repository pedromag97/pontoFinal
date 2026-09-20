-- Migração: o funcionário pode avisar que a app não o deixa picar.
--
-- O caso do Reinaldo demorou dias a chegar à gestão: ele tentava, falhava
-- e não tinha por onde dizer. As tentativas perdidas ficavam no servidor,
-- mas ninguém as via até alguém ir procurar.
--
-- Este botão é a válvula de escape: não depende de GPS, de câmara nem da
-- digital — só de haver rede. Guarda o contexto técnico automaticamente,
-- para a gestão não ficar dependente do que a pessoa souber explicar.

create table if not exists public.problem_reports (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles (id) on delete cascade,
  -- Que movimento estava a tentar (nulo se nem chegou a escolher).
  entry_type text,
  note text,
  -- Estado da app no momento: telemóvel registado, GPS, último erro.
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null
);

create index if not exists problem_reports_abertos_idx
  on public.problem_reports (created_at desc)
  where resolved_at is null;

alter table public.problem_reports enable row level security;

-- A gestão lê e arruma. A criação é do servidor (a rota junta o contexto),
-- por isso não há política de insert para o cliente.
drop policy if exists "problem_reports_select_admin" on public.problem_reports;
create policy "problem_reports_select_admin"
  on public.problem_reports for select to authenticated
  using (public.is_admin());

drop policy if exists "problem_reports_update_admin" on public.problem_reports;
create policy "problem_reports_update_admin"
  on public.problem_reports for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
