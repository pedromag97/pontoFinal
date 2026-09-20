-- Migração: saída por selfie quando a impressão digital falha.
--
-- O Reinaldo perdeu dois dias de trabalho por causa disto: a chave de
-- acesso desapareceu do telemóvel dele (passkey sincronizada — basta uma
-- reposição do gestor de palavras-passe) e o servidor continuou a exigir
-- a assinatura que o aparelho já não conseguia dar. Impasse fechado, sem
-- nada que ele pudesse fazer.
--
-- Passa a haver saída: a app oferece tirar selfie, e o servidor aceita
-- essa picagem sem assinatura — mas só quando foi ele a autorizar neste
-- desafio, e a troco da prova mais forte (a foto). O registo fica
-- marcado e nunca é validado automaticamente.

alter table public.punch_challenges
  add column if not exists fingerprint_waived boolean not null default false;

comment on column public.punch_challenges.fingerprint_waived is
  'A app comunicou que não conseguiu usar a digital; este desafio aceita o registo sem assinatura, mas exige selfie.';
