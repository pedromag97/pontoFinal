-- Migração: um telemóvel por conta, e um telemóvel só numa conta.
--
-- Objetivo: impedir que a mesma pessoa pique por si e por um colega.
--
-- Nota importante sobre o que é tecnicamente possível: o WebAuthn nunca
-- revela ao servidor QUE dedo foi usado — a digital fica no aparelho e o
-- que chega aqui é só uma assinatura. Não dá, portanto, para garantir
-- "um dedo por conta" ao nível da impressão digital. O que dá para
-- garantir, e é o que trava a fraude na prática, é:
--   1. cada conta tem no máximo UM aparelho registado;
--   2. cada aparelho só pode estar registado numa conta.

alter table public.webauthn_credentials
  add column if not exists device_uid text,
  add column if not exists device_type text,
  add column if not exists backed_up boolean;

comment on column public.webauthn_credentials.device_uid is
  'Identificador do aparelho, gerado na app e guardado no browser. Serve para impedir que dois funcionários se registem no mesmo telemóvel.';
comment on column public.webauthn_credentials.device_type is
  'singleDevice = chave presa a este aparelho; multiDevice = chave sincronizada na conta iCloud/Google, logo pode existir noutros aparelhos.';

-- 1. Uma conta, um aparelho. Trocar de telemóvel passa a exigir que a
--    gestão remova o antigo (botão já existente em Gestão › Funcionários).
create unique index if not exists webauthn_credentials_um_por_funcionario
  on public.webauthn_credentials (employee_id);

-- 2. Um aparelho, uma conta. A segunda tentativa de registo no mesmo
--    telemóvel, com outra conta, é recusada.
create unique index if not exists webauthn_credentials_um_por_aparelho
  on public.webauthn_credentials (device_uid)
  where device_uid is not null;
