-- Migração: só a gestão pode limpar o telemóvel de um funcionário.
--
-- Até aqui a política de RLS deixava o próprio apagar o seu registo
-- (`employee_id = auth.uid()`), o que esvaziava a regra "uma conta, um
-- aparelho": bastava apagar e registar outra vez noutro telemóvel,
-- sempre que quisesse e sem ninguém dar por isso.
--
-- A partir daqui, trocar de aparelho passa pela gestão: Gestão ›
-- Funcionários › botão do telemóvel. O funcionário continua a ver que
-- tem um aparelho associado, mas não lhe mexe.

drop policy if exists "webauthn_delete" on public.webauthn_credentials;
create policy "webauthn_delete"
  on public.webauthn_credentials for delete to authenticated
  using (public.is_admin());

-- Confirmação: a linha do delete deve mostrar apenas is_admin().
select policyname, cmd, qual
from pg_policies
where schemaname = 'public'
  and tablename = 'webauthn_credentials';
