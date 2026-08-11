-- Migração: folha de presença mensal (PDF).
-- O backoffice decide, por funcionário e por mês, se as horas de sábado
-- são apontadas na folha (por defeito NÃO — os registos ficam sempre
-- guardados no sistema, apenas não saem impressos).

create table if not exists public.sheet_settings (
  employee_id uuid not null references public.profiles (id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  include_saturdays boolean not null default false,
  primary key (employee_id, month)
);

alter table public.sheet_settings enable row level security;

-- O funcionário lê a sua própria definição (o PDF dele respeita-a);
-- só admins criam/alteram.
drop policy if exists "sheet_select_own_or_admin" on public.sheet_settings;
create policy "sheet_select_own_or_admin"
  on public.sheet_settings for select to authenticated
  using (employee_id = auth.uid() or public.is_admin());

drop policy if exists "sheet_insert_admin" on public.sheet_settings;
create policy "sheet_insert_admin"
  on public.sheet_settings for insert to authenticated
  with check (public.is_admin());

drop policy if exists "sheet_update_admin" on public.sheet_settings;
create policy "sheet_update_admin"
  on public.sheet_settings for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());
