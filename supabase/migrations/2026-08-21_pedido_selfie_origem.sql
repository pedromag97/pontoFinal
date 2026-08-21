-- Migração: ligar o pedido de selfie ao registo que o originou.
--
-- Sem isto, anular uma recusa deixava o pedido de selfie pendurado: a
-- gestão desfazia a recusa (afinal o registo estava bom) e o funcionário
-- continuava obrigado a tirar foto na picagem seguinte, sem ninguém
-- perceber porquê.
--
-- Com a origem guardada, anular a recusa apaga o pedido que ela criou —
-- e só esse: um pedido feito à mão pela gestão fica onde está.

alter table public.selfie_requests
  add column if not exists source_entry_id uuid
    references public.time_entries (id) on delete cascade;

comment on column public.selfie_requests.source_entry_id is
  'Registo cuja recusa criou este pedido. Nulo quando foi pedido à mão.';

create index if not exists selfie_requests_origem_idx
  on public.selfie_requests (source_entry_id)
  where source_entry_id is not null;
