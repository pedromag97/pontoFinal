-- Migração: feriados geridos no painel + registos manuais do backoffice
-- + cache de geocodificação (concelho na folha de presença).

-- ------------------------------------------------------------
-- 1. FERIADOS (pré-carga: Portugal 2026–2027; gerir no painel)
-- ------------------------------------------------------------

create table if not exists public.holidays (
  holiday_date date primary key,
  name text not null
);

alter table public.holidays enable row level security;

drop policy if exists "holidays_select_all" on public.holidays;
create policy "holidays_select_all"
  on public.holidays for select to authenticated
  using (true);

drop policy if exists "holidays_insert_admin" on public.holidays;
create policy "holidays_insert_admin"
  on public.holidays for insert to authenticated
  with check (public.is_admin());

drop policy if exists "holidays_update_admin" on public.holidays;
create policy "holidays_update_admin"
  on public.holidays for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "holidays_delete_admin" on public.holidays;
create policy "holidays_delete_admin"
  on public.holidays for delete to authenticated
  using (public.is_admin());

insert into public.holidays (holiday_date, name) values
  ('2026-01-01', 'Ano Novo'),
  ('2026-04-03', 'Sexta-feira Santa'),
  ('2026-04-05', 'Páscoa'),
  ('2026-04-25', 'Dia da Liberdade'),
  ('2026-05-01', 'Dia do Trabalhador'),
  ('2026-06-04', 'Corpo de Deus'),
  ('2026-06-10', 'Dia de Portugal'),
  ('2026-08-15', 'Assunção de Nossa Senhora'),
  ('2026-10-05', 'Implantação da República'),
  ('2026-11-01', 'Todos os Santos'),
  ('2026-12-01', 'Restauração da Independência'),
  ('2026-12-08', 'Imaculada Conceição'),
  ('2026-12-25', 'Natal'),
  ('2027-01-01', 'Ano Novo'),
  ('2027-03-26', 'Sexta-feira Santa'),
  ('2027-03-28', 'Páscoa'),
  ('2027-04-25', 'Dia da Liberdade'),
  ('2027-05-01', 'Dia do Trabalhador'),
  ('2027-05-27', 'Corpo de Deus'),
  ('2027-06-10', 'Dia de Portugal'),
  ('2027-08-15', 'Assunção de Nossa Senhora'),
  ('2027-10-05', 'Implantação da República'),
  ('2027-11-01', 'Todos os Santos'),
  ('2027-12-01', 'Restauração da Independência'),
  ('2027-12-08', 'Imaculada Conceição'),
  ('2027-12-25', 'Natal')
on conflict (holiday_date) do nothing;

-- ------------------------------------------------------------
-- 2. CACHE DE GEOCODIFICAÇÃO (GPS → concelho, para a folha)
--    Só o servidor lê/escreve (service role) — sem políticas.
-- ------------------------------------------------------------

create table if not exists public.geocode_cache (
  key text primary key,
  locality text not null,
  created_at timestamptz not null default now()
);

alter table public.geocode_cache enable row level security;

-- ------------------------------------------------------------
-- 3. REGISTOS MANUAIS DO BACKOFFICE
--    (sem foto/GPS; hora definida pelo admin; flag "manual")
-- ------------------------------------------------------------

alter table public.time_entries alter column latitude drop not null;
alter table public.time_entries alter column longitude drop not null;
alter table public.time_entries
  add column if not exists manual boolean not null default false;

create or replace function public.prepare_time_entry()
returns trigger
language plpgsql
as $$
declare
  f jsonb := '{}'::jsonb;
  matched_id uuid;
  has_sites boolean;
begin
  new.manual := coalesce(new.manual, false);

  -- Registo manual criado pelo backoffice (service role):
  -- a hora é a definida pelo admin; fica sinalizado para auditoria.
  if new.manual and auth.role() = 'service_role' then
    new.created_at := coalesce(new.created_at, now());
    new.entry_date := (new.created_at at time zone 'Europe/Lisbon')::date;
    new.synced_offline := false;
    new.flags := jsonb_build_object('manual', true);
    return new;
  end if;
  new.manual := false;

  -- Registos normais exigem GPS (a app garante; isto trava clientes forjados).
  if new.latitude is null or new.longitude is null then
    raise exception 'GPS obrigatório';
  end if;

  new.created_at := now();
  new.synced_offline := coalesce(new.synced_offline, false);

  if new.synced_offline and new.client_timestamp is not null then
    new.entry_date := (new.client_timestamp at time zone 'Europe/Lisbon')::date;
    f := f || jsonb_build_object('offline_sync', true);
  else
    new.entry_date := (now() at time zone 'Europe/Lisbon')::date;
    if new.client_timestamp is not null
       and abs(extract(epoch from (now() - new.client_timestamp))) > 300 then
      f := f || jsonb_build_object('clock_drift', true);
    end if;
  end if;

  if new.gps_accuracy is not null and new.gps_accuracy > 100 then
    f := f || jsonb_build_object('low_gps_accuracy', true);
  end if;

  select exists (select 1 from public.worksites where active) into has_sites;
  if has_sites then
    select ws.id into matched_id
    from public.worksites ws
    where ws.active
      and public.haversine_m(new.latitude, new.longitude,
                             ws.latitude, ws.longitude) <= ws.radius_m
    order by public.haversine_m(new.latitude, new.longitude,
                                ws.latitude, ws.longitude)
    limit 1;

    if matched_id is not null then
      new.worksite_id := matched_id;
    else
      f := f || jsonb_build_object('out_of_area', true);
    end if;
  end if;

  new.flags := f;
  return new;
end;
$$;
