-- Migração: validação de registos pelo backoffice.
-- Cada registo fica "por validar" até um admin o conferir. A validação é
-- reversível e fica com autor + data para auditoria.

alter table public.time_entries
  add column if not exists validated_at timestamptz;
alter table public.time_entries
  add column if not exists validated_by uuid
    references public.profiles (id) on delete set null;

create index if not exists time_entries_validated_idx
  on public.time_entries (validated_at);
