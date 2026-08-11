# Ponto Final — Folha de ponto com selfie + GPS

PWA de registo de presença para funcionários de obra (redes de fibra ótica em
França), com painel de gestão em Portugal. **Toda a app está em português**
(a estrutura i18n em `src/lib/i18n/` permite reativar o francês mais tarde).

- **App do funcionário:** login → selfie pela câmara frontal → carimbo
  automático de GPS + data/hora → confirmação. Entrada e saída por dia; nos
  dias configurados pelo admin, também saída e volta do almoço (4 registos).
  Inclui a "Folha do mês": consulta dos próprios registos com horas por dia
  e totais mensais (dias + horas), e o download da **folha de presença em PDF**
  (layout tipo "Registre de Présence": linha por dia, blocos manhã/tarde com
  coluna Ass. para assinar em papel, horas arredondadas aos 15 min, feriados
  franceses marcados) — o funcionário assina e envia à empresa. O admin também
  descarrega a folha de qualquer funcionário no Resumo, onde controla, por
  funcionário e por mês, se os sábados são apontados na folha (por defeito não;
  os registos ficam sempre no sistema). Migração:
  `supabase/migrations/2026-08-12_folha_presenca.sql`.
- **Painel de gestão:** funcionários, registos com foto/mapa/flags de fraude,
  horário de almoço por dia da semana, exportação CSV/Excel com horas
  trabalhadas (almoço descontado), resumo mensal, retenção RGPD.

**Stack:** Next.js (App Router, TypeScript) · Supabase (Auth + Postgres + Storage) ·
Tailwind CSS · PWA · deploy Vercel.

---

## 1. Setup do Supabase

1. Cria um projeto em [supabase.com](https://supabase.com) (região `eu-west` —
   dados na UE, relevante para RGPD).
2. Abre **SQL Editor** → cola e corre o conteúdo de
   [`supabase/schema.sql`](supabase/schema.sql). Isto cria as tabelas
   (`profiles`, `time_entries`), triggers, políticas RLS e o bucket privado
   `selfies`.
3. Em **Authentication → Providers → Email**: desativa "Confirm email"
   (as contas são criadas pela gestão, não há self-signup). Em
   **Authentication → Sign In / Up**, desativa o signup público
   ("Allow new users to sign up" → off).
4. Em **Project Settings → API**, copia:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (⚠️ nunca expor no browser
     nem commitar)

## 2. Correr localmente

```bash
npm install
cp .env.example .env.local   # preencher com as chaves do passo 1
npm run dev
```

Abre `http://localhost:3000`.

> **Câmara/GPS em desenvolvimento:** os browsers só dão acesso à câmara e ao
> GPS em contexto seguro. `localhost` conta como seguro; para testar no
> telemóvel usa o deploy na Vercel (HTTPS) ou `npx ngrok http 3000`.

## 3. Criar o primeiro admin

1. Supabase Dashboard → **Authentication → Users → Add user** → email +
   password, marca **Auto Confirm User**.
2. SQL Editor:

```sql
update public.profiles
  set role = 'admin', full_name = 'Nome do Gestor'
  where id = (select id from auth.users where email = 'gestor@empresa.com');
```

3. Faz login na app com esse email — és redirecionado para `/admin`.

## 4. Contas de teste (seed)

Depois de teres o admin:

1. Entra em **Funcionários** no painel e cria um funcionário de teste
   (ex.: username `joao.silva` / password com 8+ caracteres — não é preciso
   email: internamente é criado `joao.silva@ponto.lusocabo.com`, que nunca
   recebe correio; também podes usar um email real).
2. Abre uma janela anónima (ou o telemóvel), faz login com essa conta —
   aparece o ecrã de consentimento RGPD (FR) e depois o fluxo de pointage.

## 5. Deploy na Vercel

1. Faz push do repositório para o GitHub.
2. [vercel.com](https://vercel.com) → **New Project** → importa o repo
   (framework Next.js detetado automaticamente).
3. Em **Environment Variables** adiciona:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` (valor aleatório longo).
4. Deploy. O `vercel.json` já configura um **cron mensal** (dia 1, 03:00 UTC)
   que chama `/api/admin/retention` para apagar fotos com mais de 6 meses —
   a Vercel envia automaticamente o header `Authorization: Bearer $CRON_SECRET`.

### Instalar no telemóvel (PWA)

Android/Chrome: abrir o site → menu ⋮ → **Adicionar ao ecrã principal**.
iOS/Safari: **Partilhar → Adicionar ao ecrã principal**. A app abre em modo
standalone, com ícone próprio.

## 6. Como funciona a anti-fraude

| Medida | Implementação |
|---|---|
| Hora oficial no servidor | Trigger `prepare_time_entry` força `created_at = now()` e `entry_date` (Europe/Lisbon) na base de dados — o cliente não consegue forjar. |
| Hora do telemóvel guardada | `client_timestamp`; desvio > 5 min ⇒ flag `clock_drift`. |
| Precisão GPS | `gps_accuracy` guardada; > 100 m ⇒ flag `low_gps_accuracy`. |
| 1 registo de cada tipo por dia | Índice único `(employee_id, entry_type, entry_date)` na BD. Tipos: entrada, saída almoço, volta almoço, saída. |
| Almoço por dia da semana | Tabela `lunch_schedule` (editável no Resumo do painel). Nos dias marcados, a app do funcionário pede os 4 registos; as horas exportadas descontam o intervalo. |
| Raio geográfico por obra | Página Obras no painel: nome + coordenadas + raio. O trigger associa cada registo à obra mais próxima dentro do raio; fora de todas as obras ativas → flag "Fora da obra". Sem obras ativas, a verificação fica desligada. |
| Manutenção por registo | Botão 🔧 em cada registo (painel Registos): marca-o como feito em trabalho de manutenção (grandes zonas de intervenção). A flag "Fora da obra" fica guardada mas deixa de contar como suspeita; desmarcar reverte. Nos exports, a coluna Obra mostra "Manutenção". |
| Registos offline | Sem rede, o registo (selfie+GPS) fica no IndexedDB do telemóvel e sincroniza sozinho quando a ligação volta. Estes registos ficam com a flag "Enviado offline" e usam a hora do telemóvel como data — a hora oficial do servidor não é possível, por isso a gestão deve revê-los. O service worker serve a app do cache para ela abrir offline. |
| Captura direta | `getUserMedia` com `facingMode: 'user'` (a foto é tirada dentro da app); fallback `<input capture="user">` só se a câmara falhar. |
| Fotos privadas | Bucket não-público; acesso só por signed URLs com expiração (1 h no painel, 7 dias nos exports). |
| Registos imutáveis | Sem política RLS de UPDATE em `time_entries`. |

**Limitação documentada:** uma PWA não consegue garantir 100% que o fallback de
câmara não permite escolher uma foto antiga da galeria (depende do
dispositivo/browser). O caminho principal (`getUserMedia`) captura sempre em
direto; o fallback só aparece se a câmara falhar. Para garantia total seria
precisa uma app nativa. Os carimbos de hora/GPS do servidor mitigam o risco.

**Não incluído (possível fase 3):** francês por funcionário (estrutura i18n
pronta); notificações push; relatórios automáticos por email.

## 7. RGPD / Proteção de dados (funcionários em França)

⚠️ **Validar com jurista/contabilista antes de usar em produção.** Escolhas
implementadas:

- **Base de tratamento & consentimento:** no primeiro login o funcionário vê um
  ecrã de consentimento em francês (o que é recolhido, para quê, retenção,
  direitos) e tem de aceitar; a data fica em `profiles.consent_given_at`.
  Nota jurídica: em contexto laboral, o consentimento pode não ser considerado
  "livre" pela CNIL — o jurista pode preferir fundamentar em interesse legítimo
  / execução do contrato, mantendo este ecrã como dever de informação.
- **Minimização:** guarda-se apenas selfie, GPS e horas. A selfie é prova de
  presença; a captura sistemática do rosto aproxima-se de dado biométrico, pelo
  que a CNIL pode exigir avaliação de impacto (AIPD/DPIA).
- **Retenção:** fotos apagadas automaticamente após **6 meses** (cron mensal ou
  botão no painel); os registos de horas/GPS mantêm-se para fins salariais.
  O período é configurável em `src/app/api/admin/retention/route.ts`
  (`RETENTION_MONTHS`).
- **Direito ao apagamento:** botão "Apagar dados (RGPD)" por funcionário no
  painel (apaga fotos + registos e, opcionalmente, a conta).
- **Acesso restrito:** RLS em todas as tabelas — cada funcionário só vê os seus
  registos; só admins veem tudo. Bucket privado com signed URLs.
- **Localização dos dados:** escolher região UE no Supabase (passo 1).

## 8. Estrutura do projeto

```
src/
├── app/
│   ├── login/                  # login (FR)
│   ├── pointage/               # app do funcionário (FR)
│   ├── admin/                  # painel de gestão (PT)
│   │   ├── registos/           # tabela filtrável + exports
│   │   └── funcionarios/       # gestão de contas
│   └── api/admin/
│       ├── employees/          # criar/editar contas (service role)
│       ├── employees/[id]/erase# RGPD — apagar dados
│       ├── export/             # CSV + XLSX
│       └── retention/          # purga de fotos > 6 meses
├── components/
│   ├── employee/               # EmployeeHome, CameraCapture, ConsentScreen
│   └── admin/                  # EmployeeManager, RetentionButton
├── lib/
│   ├── supabase/               # client / server / admin (service role)
│   ├── i18n/                   # fr.json, pt.json (+ novos idiomas aqui)
│   └── format.ts               # datas/horas em Europe/Lisbon
supabase/schema.sql             # correr no SQL Editor do Supabase
public/                         # manifest.json, sw.js, ícones, offline.html
```

## 9. Notas

- **Fuso horário:** todas as horas são registadas e mostradas em hora de
  Portugal (`Europe/Lisbon`), incluindo nos exports — é o fuso do processamento
  salarial. Os funcionários em França veem as horas em hora portuguesa
  (−1h face ao relógio local). Configurável em `src/lib/format.ts`
  (`WORKSITE_TZ`) + trigger `prepare_time_entry` no Supabase.
- **Idiomas:** para adicionar um idioma, criar `src/lib/i18n/en.json` com as
  mesmas chaves e registá-lo em `src/lib/i18n/index.ts`.
- **Password reset:** feito pela gestão no painel (não há fluxo de email de
  recuperação — as contas são geridas centralmente).
- **Login por username:** o Supabase Auth exige email, por isso um username
  `joao` é mapeado para o email interno `joao@ponto.lusocabo.com`
  (domínio em `src/lib/username.ts`). O campo de login aceita ambos —
  funcionários usam o username, admins podem usar o email real.
  Se a base de dados foi criada antes desta funcionalidade, corre
  `supabase/migrations/2026-08-10_username_login.sql`.
- **Migrações:** os ficheiros em `supabase/migrations/` são para bases de dados
  já criadas com versões antigas do `schema.sql` — corre-os por ordem de data
  no SQL Editor. Instalações novas só precisam do `schema.sql`.
  - `2026-08-11_almoco.sql`: tipos de registo de almoço + tabela
    `lunch_schedule` (horário de almoço por dia da semana).
  - `2026-08-11_obras_offline.sql`: tabela `worksites` (obras com raio
    geográfico) + colunas `worksite_id`/`synced_offline` + trigger com
    geofence e suporte a registos sincronizados offline.
  - `2026-08-11_fuso_lisboa.sql`: fuso do cálculo do dia → Europe/Lisbon.
  - `2026-08-11_lembretes.sql`: tabelas de push + agendamento pg_cron dos
    lembretes (substituir `<CRON_SECRET>` antes de correr a parte 2).
  - `2026-08-11_manutencao.sql`: (obsoleta — substituída pela seguinte)
  - `2026-08-11_manutencao_registo.sql`: coluna `maintenance` em time_entries
    (manutenção atribuída ao registo no backoffice, não ao funcionário);
    remove a abordagem anterior.
- **Lembretes push:** o funcionário ativa as notificações na app (banner 🔔).
  Um cron no Supabase (pg_cron, 15 em 15 min) chama `/api/cron/reminders`,
  que envia: "volta do almoço?" (2 h após a saída para almoço sem regresso) e
  "regista a saída!" (9 h após a entrada sem saída) — máx. 1 de cada por dia,
  apenas entre as 08h e as 22h de Lisboa. Requer as variáveis VAPID
  (`npx web-push generate-vapid-keys`) na Vercel. No iPhone, as notificações
  só funcionam com a app instalada no ecrã principal (iOS 16.4+).
- **Mapa do dia:** página Mapa no painel — obras (círculo = raio) e registos
  do dia escolhido, coloridos por tipo, com popup (nome, hora, foto).
  Tiles do OpenStreetMap, sem chave de API.
