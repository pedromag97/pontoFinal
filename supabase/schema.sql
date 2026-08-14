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
  -- Obras móveis (equipas com grandes zonas de intervenção) não têm ponto
  -- fixo: ficam fora da verificação de raio e são atribuídas à mão.
  mobile boolean not null default false,
  latitude double precision,
  longitude double precision,
  radius_m int not null default 500 check (radius_m between 50 and 50000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint worksites_fixas_com_coords
    check (mobile or (latitude is not null and longitude is not null))
);

-- Obras atribuídas a cada funcionário: um registo dentro de uma obra
-- atribuída (e sem avisos) fica validado automaticamente.
create table public.employee_worksites (
  employee_id uuid not null references public.profiles (id) on delete cascade,
  worksite_id uuid not null references public.worksites (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (employee_id, worksite_id)
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
  latitude double precision,  -- null apenas em registos manuais do backoffice
  longitude double precision,
  gps_accuracy double precision, -- metros
  client_timestamp timestamptz,  -- hora reportada pelo telemóvel (só para comparação)
  created_at timestamptz not null default now(), -- hora OFICIAL (servidor)
  worksite_id uuid references public.worksites (id) on delete set null,
  -- true quando o registo foi feito sem rede e sincronizado mais tarde:
  -- nesse caso entry_date vem da hora do telemóvel e o registo fica sinalizado.
  synced_offline boolean not null default false,
  -- Criado manualmente pelo backoffice (funcionário esqueceu-se) — sem
  -- foto/GPS, hora definida pelo admin, sinalizado para auditoria.
  manual boolean not null default false,
  -- Conferido pelo backoffice antes do processamento salarial (reversível).
  validated_at timestamptz,
  validated_by uuid references public.profiles (id) on delete set null,
  -- Recusado pelo backoffice com motivo: deixa de contar (sequência, horas,
  -- folhas) mas fica para auditoria; o funcionário regista de novo.
  rejected_at timestamptz,
  rejected_by uuid references public.profiles (id) on delete set null,
  rejection_reason text,
  flags jsonb not null default '{}'::jsonb
);

comment on table public.time_entries is 'Registos de ponto. created_at é a hora oficial (servidor); client_timestamp é a hora do telemóvel, guardada para deteção de fraude.';

-- Um registo de cada tipo (entrada/saida) por funcionário por dia
-- (registos recusados não contam — pode haver um novo a substituí-los).
create unique index time_entries_one_per_day
  on public.time_entries (employee_id, entry_type, entry_date)
  where rejected_at is null;

create index time_entries_date_idx on public.time_entries (entry_date);
create index time_entries_employee_idx on public.time_entries (employee_id, entry_date);
create index time_entries_validated_idx on public.time_entries (validated_at);

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

-- Feriados (pré-carga: Portugal 2026–2027 — gerir na página Feriados).
create table public.holidays (
  holiday_date date primary key,
  name text not null
);

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

-- Cache de geocodificação (GPS → concelho) usada na folha de presença.
-- Só o servidor lê/escreve (service role) — sem políticas.
create table public.geocode_cache (
  key text primary key,
  locality text not null,
  created_at timestamptz not null default now()
);

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
    f := f || jsonb_build_object('offline_sync', true);

    -- A data de um registo offline vem do telemóvel; só se aceita quando
    -- é plausível (não no futuro, não com mais de 7 dias). Fora disso é
    -- recusada: fica o dia do servidor e a marca bad_client_clock.
    if new.client_timestamp <= now() + interval '5 minutes'
       and new.client_timestamp >= now() - interval '7 days' then
      new.entry_date := (new.client_timestamp at time zone 'Europe/Lisbon')::date;
    else
      new.entry_date := (now() at time zone 'Europe/Lisbon')::date;
      f := f || jsonb_build_object('bad_client_clock', true);
    end if;
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

  -- Geofence: só quando existe pelo menos uma obra ativa.
  select exists (select 1 from public.worksites where active and not mobile)
    into has_sites;
  if has_sites then
    select ws.id into matched_id
    from public.worksites ws
    where ws.active
      and not ws.mobile
      and public.haversine_m(new.latitude, new.longitude,
                             ws.latitude, ws.longitude) <= ws.radius_m
    order by public.haversine_m(new.latitude, new.longitude,
                                ws.latitude, ws.longitude)
    limit 1;

    if matched_id is not null then
      new.worksite_id := matched_id;
      -- Obra atribuída ao funcionário e sem avisos que ponham a hora em
      -- causa (o GPS impreciso não conta: o registo caiu dentro do raio).
      if (f - 'low_gps_accuracy') = '{}'::jsonb and exists (
        select 1 from public.employee_worksites ew
        where ew.employee_id = new.employee_id
          and ew.worksite_id = matched_id
      ) then
        new.validated_at := now();
        new.validated_by := null; -- validação automática do sistema
      end if;
    else
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
alter table public.employee_worksites enable row level security;
alter table public.holidays enable row level security;

-- employee_worksites: cada um vê as suas obras; só admins atribuem.
create policy "ew_select"
  on public.employee_worksites for select to authenticated
  using (employee_id = auth.uid() or public.is_admin());
create policy "ew_insert_admin"
  on public.employee_worksites for insert to authenticated
  with check (public.is_admin());
create policy "ew_delete_admin"
  on public.employee_worksites for delete to authenticated
  using (public.is_admin());
alter table public.geocode_cache enable row level security;

-- holidays: todos leem; só admins gerem.
create policy "holidays_select_all"
  on public.holidays for select to authenticated using (true);
create policy "holidays_insert_admin"
  on public.holidays for insert to authenticated with check (public.is_admin());
create policy "holidays_update_admin"
  on public.holidays for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "holidays_delete_admin"
  on public.holidays for delete to authenticated using (public.is_admin());

-- geocode_cache: só service role — sem políticas.

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
