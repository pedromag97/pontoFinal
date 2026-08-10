# Ponto Final — Folha de ponto com selfie + GPS

PWA de registo de presença para funcionários de obra (redes de fibra ótica em
França), com painel de gestão em Portugal.

- **App do funcionário (francês):** login → selfie pela câmara frontal →
  carimbo automático de GPS + data/hora → confirmação. Entrada e saída por dia.
- **Painel de gestão (português):** funcionários, registos com foto/mapa/flags
  de fraude, exportação CSV/Excel, resumo mensal, retenção RGPD.

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
| Hora oficial no servidor | Trigger `prepare_time_entry` força `created_at = now()` e `entry_date` (Europe/Paris) na base de dados — o cliente não consegue forjar. |
| Hora do telemóvel guardada | `client_timestamp`; desvio > 5 min ⇒ flag `clock_drift`. |
| Precisão GPS | `gps_accuracy` guardada; > 100 m ⇒ flag `low_gps_accuracy`. |
| 1 entrada + 1 saída por dia | Índice único `(employee_id, entry_type, entry_date)` na BD. |
| Captura direta | `getUserMedia` com `facingMode: 'user'` (a foto é tirada dentro da app); fallback `<input capture="user">` só se a câmara falhar. |
| Fotos privadas | Bucket não-público; acesso só por signed URLs com expiração (1 h no painel, 7 dias nos exports). |
| Registos imutáveis | Sem política RLS de UPDATE em `time_entries`. |

**Limitação documentada:** uma PWA não consegue garantir 100% que o fallback de
câmara não permite escolher uma foto antiga da galeria (depende do
dispositivo/browser). O caminho principal (`getUserMedia`) captura sempre em
direto; o fallback só aparece se a câmara falhar. Para garantia total seria
precisa uma app nativa. Os carimbos de hora/GPS do servidor mitigam o risco.

**Fase 2 (não incluído):** raio geográfico por obra com flag "fora do local";
modo offline com sincronização.

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
│   └── format.ts               # datas/horas em Europe/Paris
supabase/schema.sql             # correr no SQL Editor do Supabase
public/                         # manifest.json, sw.js, ícones, offline.html
```

## 9. Notas

- **Fuso horário:** todas as horas são registadas e mostradas em hora de França
  (`Europe/Paris`), incluindo nos exports — é o fuso da obra.
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
