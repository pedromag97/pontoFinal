-- ============================================================
-- PONTO FINAL — Schema Supabase
-- Correr este ficheiro no SQL Editor do Supabase (uma só vez).
-- Cria: tabelas, triggers, RLS, bucket de Storage e políticas.
-- ============================================================

-- ------------------------------------------------------------
-- 1. TABELAS
-- ------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  -- Login por username (funcionários). O email interno correspondente é
  -- <username>@ponto.lusocabo.com. Null para contas com email real (admins).
  username text unique,
  full_name text not null default '',
  role text not null default 'employee' check (role in ('employee', 'admin')),
  active boolean not null default true,
  -- Equipa de manutenção: grandes zonas de intervenção — os registos deste
  -- funcionário nunca levam a flag out_of_area.
  maintenance_team boolean not null default false,
  preferred_language text not null default 'fr',
  consent_given_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.profiles is 'Perfil de cada utilizador (funcionário ou admin), ligado a auth.users.';

-- Obras (locais de trabalho) com raio geográfico. Um registo feito fora de
-- todas as obras ativas fica sinalizado com a flag out_of_area.
create table public.worksites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  latitude double precision not null,
  longitude double precision not null,
  radius_m int not null default 500 check (radius_m between 50 and 50000),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles (id) on delete cascade,
  entry_type text not null
    check (entry_type in ('entrada', 'saida_almoco', 'volta_almoco', 'saida')),
  -- Dia do registo em hora de Portugal (fuso do processamento salarial).
  -- Preenchido pelo trigger com base no relógio do SERVIDOR — o cliente não manda.
  entry_date date not null default ((now() at time zone 'Europe/Lisbon')::date),
  photo_path text, -- caminho no bucket 'selfies'; fica null após purga de retenção
  latitude double precision not null,
  longitude double precision not null,
  gps_accuracy double precision, -- metros
  client_timestamp timestamptz,  -- hora reportada pelo telemóvel (só para comparação)
  created_at timestamptz not null default now(), -- hora OFICIAL (servidor)
  worksite_id uuid references public.worksites (id) on delete set null,
  -- true quando o registo foi feito sem rede e sincronizado mais tarde:
  -- nesse caso entry_date vem da hora do telemóvel e o registo fica sinalizado.
  synced_offline boolean not null default false,
  flags jsonb not null default '{}'::jsonb
);

comment on table public.time_entries is 'Registos de ponto. created_at é a hora oficial (servidor); client_timestamp é a hora do telemóvel, guardada para deteção de fraude.';

-- Um registo de cada tipo (entrada/saida) por funcionário por dia.
create unique index time_entries_one_per_day
  on public.time_entries (employee_id, entry_type, entry_date);

create index time_entries_date_idx on public.time_entries (entry_date);
create index time_entries_employee_idx on public.time_entries (employee_id, entry_date);

-- Configuração do horário de almoço por dia da semana (0 = domingo … 6 = sábado).
-- Nos dias com lunch_required, o funcionário faz 4 registos
-- (entrada, saída almoço, volta almoço, saída); nos restantes, 2.
create table public.lunch_schedule (
  weekday int primary key check (weekday between 0 and 6),
  lunch_required boolean not null default false
);

insert into public.lunch_schedule (weekday, lunch_required)
values (0, false), (1, false), (2, false), (3, false),
       (4, false), (5, false), (6, false)
on conflict (weekday) do nothing;

-- Subscrições de notificações push (lembretes; uma por dispositivo).
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

-- Lembretes já enviados (máx. 1 por funcionário/dia/tipo).
create table public.reminders_sent (
  employee_id uuid not null references public.profiles (id) on delete cascade,
  entry_date date not null,
  kind text not null,
  sent_at timestamptz not null default now(),
  primary key (employee_id, entry_date, kind)
);

-- NOTA: o agendamento dos lembretes (pg_cron → /api/cron/reminders) está em
-- supabase/migrations/2026-08-11_lembretes.sql, parte 2 — requer o CRON_SECRET.

-- ------------------------------------------------------------
-- 2. FUNÇÕES E TRIGGERS
-- ------------------------------------------------------------

-- is_admin(): usada nas políticas RLS. SECURITY DEFINER para não haver
-- recursão de RLS ao consultar profiles a partir das próprias políticas.
create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin' and p.active
  );
$$;

-- Cria automaticamente o profile quando um utilizador é criado no Auth.
-- full_name e role vêm do user_metadata (definidos pela API de admin da app).
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'role', 'employee'),
    nullif(new.raw_user_meta_data ->> 'username', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Distância em metros entre duas coordenadas (fórmula de haversine).
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

-- Antes de inserir um registo:
--  - força created_at com o relógio do servidor (anti-fraude);
--  - registos sincronizados offline usam a data da hora do telemóvel
--    (flag offline_sync para a gestão rever);
--  - calcula flags: GPS impreciso, relógio desviado, fora de todas as obras;
--  - associa o registo à obra mais próxima dentro do raio.
create or replace function public.prepare_time_entry()
returns trigger
language plpgsql
as $$
declare
  f jsonb := '{}'::jsonb;
  matched_id uuid;
  has_sites boolean;
  is_maintenance boolean;
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

  select coalesce(p.maintenance_team, false) into is_maintenance
  from public.profiles p where p.id = new.employee_id;

  -- Geofence: só quando existe pelo menos uma obra ativa.
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
    elsif not is_maintenance then
      f := f || jsonb_build_object('out_of_area', true);
    end if;
  end if;

  new.flags := f;
  return new;
end;
$$;

create trigger time_entries_prepare
  before insert on public.time_entries
  for each row execute function public.prepare_time_entry();

-- ------------------------------------------------------------
-- 3. ROW LEVEL SECURITY
-- ------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.time_entries enable row level security;
alter table public.lunch_schedule enable row level security;
alter table public.worksites enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.reminders_sent enable row level security;

-- push_subscriptions: cada um gere as suas subscrições.
create policy "push_own"
  on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- reminders_sent: só o servidor (service role) — sem políticas authenticated.

-- worksites: todos leem (o trigger corre no contexto do funcionário);
-- só admins criam/alteram/apagam.
create policy "worksites_select_all"
  on public.worksites for select to authenticated
  using (true);

create policy "worksites_insert_admin"
  on public.worksites for insert to authenticated
  with check (public.is_admin());

create policy "worksites_update_admin"
  on public.worksites for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "worksites_delete_admin"
  on public.worksites for delete to authenticated
  using (public.is_admin());

-- lunch_schedule: todos leem (a app do funcionário precisa de saber o horário);
-- só admins alteram. Linhas fixas (7) — sem insert/delete.
create policy "lunch_select_all"
  on public.lunch_schedule for select to authenticated
  using (true);

create policy "lunch_update_admin"
  on public.lunch_schedule for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- profiles: cada um vê o seu; admins veem todos.
create policy "profiles_select_own_or_admin"
  on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());

-- profiles: o próprio só pode atualizar idioma e consentimento
-- (restrição por coluna via GRANT — nunca role/active/nome).
-- Gestão de funcionários é feita pela app com a service_role key.
create policy "profiles_update_self"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

revoke update on public.profiles from authenticated;
grant update (preferred_language, consent_given_at) on public.profiles to authenticated;

-- time_entries: funcionário ativo insere apenas registos seus.
create policy "entries_insert_own_active"
  on public.time_entries for insert to authenticated
  with check (
    employee_id = auth.uid()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.active)
  );

-- time_entries: cada um lê os seus; admins leem todos.
create policy "entries_select_own_or_admin"
  on public.time_entries for select to authenticated
  using (employee_id = auth.uid() or public.is_admin());

-- time_entries: só admins apagam (RGPD). Sem update — registos imutáveis.
create policy "entries_delete_admin"
  on public.time_entries for delete to authenticated
  using (public.is_admin());

-- ------------------------------------------------------------
-- 4. STORAGE — bucket privado 'selfies'
-- ------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('selfies', 'selfies', false)
on conflict (id) do nothing;

-- Upload: cada funcionário só escreve na sua própria pasta (<uid>/...).
create policy "selfies_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'selfies'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Leitura: o próprio ou admins (necessário para gerar signed URLs).
create policy "selfies_select_own_or_admin"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'selfies'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

-- Apagar: só admins (retenção / RGPD).
create policy "selfies_delete_admin"
  on storage.objects for delete to authenticated
  using (bucket_id = 'selfies' and public.is_admin());

-- ------------------------------------------------------------
-- 5. PRIMEIRO ADMIN (correr manualmente DEPOIS de criar o utilizador)
-- ------------------------------------------------------------
-- 1) Supabase Dashboard → Authentication → Users → "Add user"
--    (email + password, marcar "Auto Confirm User").
-- 2) Correr, substituindo o email:
--
-- update public.profiles
--   set role = 'admin', full_name = 'Nome do Gestor'
--   where id = (select id from auth.users where email = 'gestor@empresa.com');
