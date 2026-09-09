-- Migração: separar faltas justificadas de injustificadas.
--
-- Até aqui só havia 'falta', que na prática era a justificada. A gestão
-- precisa de distinguir: uma é ausência com motivo aceite, a outra conta
-- de forma diferente para efeitos disciplinares e de salário.
--
-- 'falta' continua a significar justificada — os registos existentes
-- ficam como estão, sem conversão nem risco de reinterpretar o passado.

alter table public.absences
  drop constraint if exists absences_kind_check;

alter table public.absences
  add constraint absences_kind_check
  check (kind in ('ferias', 'baixa', 'falta', 'falta_injustificada'));

comment on column public.absences.kind is
  'ferias | baixa (médica) | falta (justificada) | falta_injustificada.';

-- ------------------------------------------------------------
-- Gestão passa a ver as picagens tentadas e nunca concluídas.
--
-- punch_challenges tinha RLS ligada e nenhuma política: só o servidor
-- lhe tocava. Para o backoffice mostrar as tentativas falhadas (a app
-- pediu o desafio e nunca voltou com o registo), os admins precisam de
-- as ler. Continua sem escrita: quem cria e consome é o servidor.
drop policy if exists "punch_challenges_select_admin" on public.punch_challenges;
create policy "punch_challenges_select_admin"
  on public.punch_challenges for select to authenticated
  using (public.is_admin());
