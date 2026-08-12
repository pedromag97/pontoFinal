-- Migração: recusa de registos pelo backoffice, com motivo.
-- O registo recusado fica guardado para auditoria mas deixa de contar
-- (sequência do dia, horas, folhas); o funcionário é notificado e pode
-- registar de novo — o índice único passa a ignorar registos recusados.

alter table public.time_entries
  add column if not exists rejected_at timestamptz;
alter table public.time_entries
  add column if not exists rejected_by uuid
    references public.profiles (id) on delete set null;
alter table public.time_entries
  add column if not exists rejection_reason text;

-- Permitir novo registo do mesmo tipo no mesmo dia depois de uma recusa.
drop index if exists public.time_entries_one_per_day;
create unique index time_entries_one_per_day
  on public.time_entries (employee_id, entry_type, entry_date)
  where rejected_at is null;
