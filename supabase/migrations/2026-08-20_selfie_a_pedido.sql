-- Migração: a gestão pode exigir selfie no próximo movimento.
--
-- Até aqui a selfie era só automática: sem telemóvel registado, fora de
-- obra, offline, ou 1 em cada 10 à sorte. Faltava a gestão poder dizer
-- "deste quero foto" — e faltava sobretudo na recusa: recusava-se um
-- registo por suspeita e o registo refeito tinha 90% de hipóteses de vir
-- sem foto nenhuma, que era precisamente a prova que se queria.
--
-- O pedido é de uso único: consome-se na picagem seguinte que traga foto
-- e desliga-se sozinho. Se ficasse ligado, ao fim de uma semana metade da
-- equipa estaria a tirar foto sempre — o oposto do que fomos fazer.

create table if not exists public.selfie_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles (id) on delete cascade,
  -- Nulo quando foi automático (recusa de um registo).
  requested_by uuid references public.profiles (id) on delete set null,
  reason text not null,
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  -- O registo que consumiu o pedido, para a gestão poder ir vê-lo.
  consumed_entry_id uuid references public.time_entries (id) on delete set null
);

-- Um funcionário só pode ter um pedido por consumir de cada vez: pedir
-- duas vezes não faz sentido e só deixava pedidos pendurados.
create unique index if not exists selfie_requests_um_pendente
  on public.selfie_requests (employee_id)
  where consumed_at is null;

create index if not exists selfie_requests_employee_idx
  on public.selfie_requests (employee_id, created_at desc);

alter table public.selfie_requests enable row level security;

-- Só a gestão vê e cria. O funcionário NÃO vê: se soubesse que lhe foi
-- pedida foto de propósito, quem está a tentar aldrabar sabia exatamente
-- quando ter cuidado. A app diz-lhe o mesmo que diz na amostragem.
drop policy if exists "selfie_requests_select_admin" on public.selfie_requests;
create policy "selfie_requests_select_admin"
  on public.selfie_requests for select to authenticated
  using (public.is_admin());

drop policy if exists "selfie_requests_insert_admin" on public.selfie_requests;
create policy "selfie_requests_insert_admin"
  on public.selfie_requests for insert to authenticated
  with check (public.is_admin());

drop policy if exists "selfie_requests_delete_admin" on public.selfie_requests;
create policy "selfie_requests_delete_admin"
  on public.selfie_requests for delete to authenticated
  using (public.is_admin());
