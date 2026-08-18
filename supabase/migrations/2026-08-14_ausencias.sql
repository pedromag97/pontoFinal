-- Migração: ausências (férias, baixa, falta justificada).
--
-- Um período por funcionário, de um dia (início = fim) ou um intervalo.
-- Efeitos: aparece na folha de presença, o funcionário não recebe lembretes
-- nesses dias, e a app mostra-lhe que está ausente.

create table if not exists public.absences (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null default 'ferias'
    check (kind in ('ferias', 'baixa', 'falta')),
  start_date date not null,
  end_date date not null,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  constraint absences_intervalo_valido check (end_date >= start_date)
);

create index if not exists absences_employee_idx
  on public.absences (employee_id, start_date, end_date);

-- Impede períodos sobrepostos para o mesmo funcionário (a base de dados
-- recusa, não é preciso confiar na interface).
create extension if not exists btree_gist;
alter table public.absences drop constraint if exists absences_sem_sobreposicao;
alter table public.absences add constraint absences_sem_sobreposicao
  exclude using gist (
    employee_id with =,
    daterange(start_date, end_date, '[]') with &&
  );

alter table public.absences enable row level security;

-- Cada funcionário vê as suas ausências; admins veem e gerem todas.
drop policy if exists "absences_select" on public.absences;
create policy "absences_select"
  on public.absences for select to authenticated
  using (employee_id = auth.uid() or public.is_admin());

drop policy if exists "absences_insert_admin" on public.absences;
create policy "absences_insert_admin"
  on public.absences for insert to authenticated
  with check (public.is_admin());

drop policy if exists "absences_update_admin" on public.absences;
create policy "absences_update_admin"
  on public.absences for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "absences_delete_admin" on public.absences;
create policy "absences_delete_admin"
  on public.absences for delete to authenticated
  using (public.is_admin());
