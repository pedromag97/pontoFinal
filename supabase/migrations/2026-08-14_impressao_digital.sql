-- Migração: registo por impressão digital (WebAuthn) + selfie só onde conta.
--
-- A impressão digital NUNCA sai do telemóvel: o que viaja é uma assinatura
-- criptográfica feita por uma chave guardada no aparelho e desbloqueada pela
-- digital. A empresa não recolhe nem guarda dados biométricos.
--
-- A selfie deixa de ser pedida em todos os registos e passa a ser exigida
-- apenas onde acrescenta alguma coisa: registo fora de obra, registo
-- offline, funcionário sem telemóvel registado, ou por amostragem
-- aleatória (efeito dissuasor).
--
-- Para a política ser real e não apenas uma sugestão à app, os registos
-- deixam de poder ser inseridos diretamente pelo cliente: passam todos
-- pelo servidor (/api/registo/entry), que confirma a assinatura, o desafio
-- e a presença (ou não) da foto.

-- 1. Chaves públicas dos telemóveis registados (nada de biometria aqui).
create table if not exists public.webauthn_credentials (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles (id) on delete cascade,
  credential_id text not null unique,
  public_key text not null,
  counter bigint not null default 0,
  device_label text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists webauthn_credentials_employee_idx
  on public.webauthn_credentials (employee_id);

alter table public.webauthn_credentials enable row level security;

-- Cada um vê os seus dispositivos; admins veem e removem todos (troca de
-- telemóvel). A escrita é feita pelo servidor (service role).
drop policy if exists "webauthn_select" on public.webauthn_credentials;
create policy "webauthn_select"
  on public.webauthn_credentials for select to authenticated
  using (employee_id = auth.uid() or public.is_admin());

drop policy if exists "webauthn_delete" on public.webauthn_credentials;
create policy "webauthn_delete"
  on public.webauthn_credentials for delete to authenticated
  using (employee_id = auth.uid() or public.is_admin());

-- 2. Desafios de cada picagem: ligam o pedido (onde estava, que movimento)
--    à resposta assinada, e guardam se a selfie era exigida desta vez.
create table if not exists public.punch_challenges (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles (id) on delete cascade,
  challenge text not null,
  entry_type text not null,
  requires_photo boolean not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists punch_challenges_employee_idx
  on public.punch_challenges (employee_id, expires_at);

-- Só o servidor lê/escreve — sem políticas para authenticated.
alter table public.punch_challenges enable row level security;

-- 3. Fechar a inserção direta de registos pelo cliente.
--    Sem isto a política acima seria só uma sugestão: bastava um cliente
--    manipulado inserir na tabela sem passar pelo servidor.
drop policy if exists "entries_insert_own_active" on public.time_entries;
