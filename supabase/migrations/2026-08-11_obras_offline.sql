-- Migração: obras com raio geográfico + registos offline.
-- Correr no SQL Editor se a base de dados já existia antes desta versão
-- (instalações novas já incluem isto no schema.sql).

-- 1. Obras (locais de trabalho) com raio.
create table if not exists public.worksites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  latitude double precision not null,
  longitude double precision not null,
  radius_m int not null default 500 check (radius_m between 50 and 50000),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.worksites enable row level security;

drop policy if exists "worksites_select_all" on public.worksites;
create policy "worksites_select_all"
  on public.worksites for select to authenticated
  using (true);

drop policy if exists "worksites_insert_admin" on public.worksites;
create policy "worksites_insert_admin"
  on public.worksites for insert to authenticated
  with check (public.is_admin());

drop policy if exists "worksites_update_admin" on public.worksites;
create policy "worksites_update_admin"
  on public.worksites for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "worksites_delete_admin" on public.worksites;
create policy "worksites_delete_admin"
  on public.worksites for delete to authenticated
  using (public.is_admin());

-- 2. Novas colunas em time_entries.
alter table public.time_entries
  add column if not exists worksite_id uuid references public.worksites (id) on delete set null;
alter table public.time_entries
  add column if not exists synced_offline boolean not null default false;

-- 3. Distância haversine (metros).
create or replace function public.haversine_m(
  lat1 float8, lon1 float8, lat2 float8, lon2 float8
) returns float8
language sql immutable
as $$
  select 12742000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) *
    power(sin(radians(lon2 - lon1) / 2), 2)
  ));
$$;

-- 4. Trigger atualizado: geofence + registos offline.
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
    new.entry_date := (new.client_timestamp at time zone 'Europe/Paris')::date;
    f := f || jsonb_build_object('offline_sync', true);
  else
    new.entry_date := (now() at time zone 'Europe/Paris')::date;
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
