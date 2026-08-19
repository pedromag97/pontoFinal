-- Migração: fechar a inserção direta de registos pelo cliente.
--
-- Segunda metade de 2026-08-14_impressao_digital.sql. CORRER SÓ DEPOIS do
-- deploy estar no ar: a partir daqui, a app antiga (que inseria direto na
-- tabela) deixa de conseguir picar.
--
-- Sem este passo, a política da selfie seria apenas uma sugestão à app:
-- bastaria um cliente manipulado inserir na tabela sem passar pelo servidor.
-- Com ele, o único caminho para criar um registo é /api/registo/entry, que
-- confirma o desafio (uso único, 5 min), a assinatura do telemóvel e a
-- presença da foto quando a política a exige.

drop policy if exists "entries_insert_own_active" on public.time_entries;

-- Confirmação: deve devolver zero linhas.
select policyname
from pg_policies
where schemaname = 'public'
  and tablename = 'time_entries'
  and cmd = 'INSERT';
