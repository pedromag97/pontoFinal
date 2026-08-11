-- Migração: manutenção passa a ser atribuída ao REGISTO (não ao funcionário).
-- O backoffice marca registos individuais como "manutenção" — a flag
-- out_of_area mantém-se guardada mas deixa de contar como suspeita.
-- Substitui a abordagem anterior (flag no funcionário).

-- 1. Coluna no registo.
alter table public.time_entries
  add column if not exists maintenance boolean not null default false;

-- 2. Trigger volta à versão sem lógica de funcionário-manutenção.
create or replace function public.prepare_time_entry()
returns trigger
language plpgsql
as $$
declare
  f jsonb := '{}'::jsonb;
  matched_id uuid;
  has_sites boolean;
begin
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

-- 3. Remove a coluna da abordagem anterior (depois de substituir o trigger).
alter table public.profiles drop column if exists maintenance_team;
