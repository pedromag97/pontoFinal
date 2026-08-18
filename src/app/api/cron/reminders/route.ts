import { NextResponse } from "next/server";
import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayWorksite, weekdayWorksite, WORKSITE_TZ } from "@/lib/format";
import type { EntryType } from "@/types";

export const runtime = "nodejs";

// Lembretes push, verificados por pg_cron (Supabase) — idealmente de 5 em
// 5 min: com cadências maiores os avisos prévios não chegam a apanhar a
// janela (ver PRE_WINDOW_MIN/LATE_WINDOW_MIN).
// Horário normal: 08h–12h / 13h–17h (hora de Portugal). Para cada um dos
// quatro movimentos há dois avisos, ambos só para quem ainda NÃO o fez:
//   - AVISO   5 min antes  (07:55, 11:55, 12:55, 16:55)
//   - ATRASO 10 min depois (08:10, 12:10, 13:10, 17:10)
// Cada aviso é enviado no máximo 1x por funcionário por dia.
// Seg–Sáb, exceto feriados; os do almoço só nos dias com almoço obrigatório.

const BEFORE_MIN = 5;
const AFTER_MIN = 10;
// O aviso prévio só faz sentido antes da hora, por isso a janela é curta
// (exige o cron aos 5 minutos). O de atraso dispara na primeira passagem
// a partir dos +10 min e tem folga larga, para funcionar mesmo que o cron
// esteja configurado com uma cadência maior — a deduplicação diária evita
// repetições.
const PRE_WINDOW_MIN = 5;
const LATE_WINDOW_MIN = 30;

interface Movement {
  type: EntryType;
  minutes: number; // hora oficial, em minutos desde a meia-noite (Lisboa)
  label: string; // "08:00"
  lunchOnly: boolean; // só em dias com almoço obrigatório
  requiresEntrada: boolean; // não incomodar quem nem entrada registou
  emoji: string;
  nome: string; // como aparece nas mensagens
}

const MOVEMENTS: Movement[] = [
  {
    type: "entrada",
    minutes: 8 * 60,
    label: "08:00",
    lunchOnly: false,
    requiresEntrada: false,
    emoji: "⏰",
    nome: "a entrada",
  },
  {
    type: "saida_almoco",
    minutes: 12 * 60,
    label: "12:00",
    lunchOnly: true,
    requiresEntrada: true,
    emoji: "🍽️",
    nome: "a saída para almoço",
  },
  {
    type: "volta_almoco",
    minutes: 13 * 60,
    label: "13:00",
    lunchOnly: true,
    requiresEntrada: true,
    emoji: "🔨",
    nome: "a volta do almoço",
  },
  {
    type: "saida",
    minutes: 17 * 60,
    label: "17:00",
    lunchOnly: false,
    requiresEntrada: true,
    emoji: "🌇",
    nome: "a saída",
  },
];

function preMessage(m: Movement) {
  return {
    title: `${m.nome[0].toUpperCase()}${m.nome.slice(1)} às ${m.label} ${m.emoji}`,
    body: `Daqui a ${BEFORE_MIN} minutos. Não te esqueças de registar ${m.nome}.`,
  };
}

function lateMessage(m: Movement) {
  return {
    title: `Falta registar ${m.nome} ⚠️`,
    body: `Já passaram ${AFTER_MIN} minutos das ${m.label} e ainda não registaste ${m.nome}. Abre a app e regista.`,
  };
}

interface EntryRow {
  employee_id: string;
  entry_type: EntryType;
}

interface Subscription {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export async function GET(request: Request) {
  // O token é comparado sem espaços à volta: uma quebra de linha apanhada
  // ao copiar o segredo não deve impedir o cron de funcionar.
  const secret = process.env.CRON_SECRET?.trim();
  const auth = request.headers.get("authorization");
  const recebido = (auth ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!secret || recebido !== secret) {
    // Diagnóstico sem revelar o segredo: distingue "variável em falta no
    // servidor" de "valor diferente do que o cron está a enviar".
    return NextResponse.json(
      {
        error: "unauthorized",
        diagnostico: {
          segredoConfiguradoNoServidor: !!secret,
          recebeuCabecalho: !!auth,
          comprimentoCoincide: !!secret && recebido.length === secret.length,
        },
      },
      { status: 401 }
    );
  }
  if (
    !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
    !process.env.VAPID_PRIVATE_KEY
  ) {
    return NextResponse.json({ error: "vapid not configured" }, { status: 500 });
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:noreply@ponto.lusocabo.com",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  const admin = createAdminClient();
  const today = todayWorksite();
  const weekday = weekdayWorksite(); // 0 = domingo

  const [hh, mm] = new Intl.DateTimeFormat("en-GB", {
    timeZone: WORKSITE_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date())
    .split(":");
  const nowMinutes = parseInt(hh, 10) * 60 + parseInt(mm, 10);
  const relogio = `${hh}:${mm}`;

  // Que avisos caem nesta passagem do cron?
  const inWindow = (inicio: number, largura: number) =>
    nowMinutes >= inicio && nowMinutes < inicio + largura;
  const devidos: { m: Movement; late: boolean }[] = [];
  for (const m of MOVEMENTS) {
    if (inWindow(m.minutes - BEFORE_MIN, PRE_WINDOW_MIN)) {
      devidos.push({ m, late: false });
    }
    if (inWindow(m.minutes + AFTER_MIN, LATE_WINDOW_MIN)) {
      devidos.push({ m, late: true });
    }
  }

  if (devidos.length === 0 || weekday === 0) {
    return NextResponse.json({ sent: 0, relogio, motivo: "fora de horário" });
  }

  const { data: holiday } = await admin
    .from("holidays")
    .select("holiday_date")
    .eq("holiday_date", today)
    .maybeSingle();
  if (holiday) {
    return NextResponse.json({ sent: 0, relogio, motivo: "feriado" });
  }

  const { data: schedule } = await admin
    .from("lunch_schedule")
    .select("lunch_required")
    .eq("weekday", weekday)
    .maybeSingle();
  const lunchRequired = schedule?.lunch_required ?? false;

  // Subscrições (quem não ativou notificações, não recebe).
  const { data: subsData, error: subsError } = await admin
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth");
  if (subsError) {
    return NextResponse.json({ error: subsError.message }, { status: 500 });
  }
  const subsByUser = new Map<string, Subscription[]>();
  for (const sub of (subsData ?? []) as Subscription[]) {
    if (!subsByUser.has(sub.user_id)) subsByUser.set(sub.user_id, []);
    subsByUser.get(sub.user_id)!.push(sub);
  }
  if (subsByUser.size === 0) {
    return NextResponse.json({ sent: 0, relogio, motivo: "sem subscrições" });
  }

  // Funcionários ativos com notificações.
  const { data: activeEmployees } = await admin
    .from("profiles")
    .select("id")
    .eq("role", "employee")
    .eq("active", true);
  // Quem está de férias/baixa/falta hoje não é incomodado.
  const { data: ausentes } = await admin
    .from("absences")
    .select("employee_id")
    .lte("start_date", today)
    .gte("end_date", today);
  const ausentesHoje = new Set(
    ((ausentes ?? []) as { employee_id: string }[]).map((a) => a.employee_id)
  );

  const destinatarios = ((activeEmployees ?? []) as { id: string }[])
    .map((p) => p.id)
    .filter((id) => subsByUser.has(id) && !ausentesHoje.has(id));

  // Registos de hoje (os recusados não contam — têm de ser refeitos).
  const { data: entriesData, error: entriesError } = await admin
    .from("time_entries")
    .select("employee_id, entry_type")
    .eq("entry_date", today)
    .is("rejected_at", null);
  if (entriesError) {
    return NextResponse.json({ error: entriesError.message }, { status: 500 });
  }
  const feitos = new Set(
    ((entriesData ?? []) as EntryRow[]).map(
      (r) => `${r.employee_id}|${r.entry_type}`
    )
  );
  const jaFez = (employeeId: string, type: EntryType) =>
    feitos.has(`${employeeId}|${type}`);

  // Lembretes já enviados hoje, para não repetir.
  const { data: sentToday } = await admin
    .from("reminders_sent")
    .select("employee_id, kind")
    .eq("entry_date", today);
  const jaEnviado = new Set(
    ((sentToday ?? []) as { employee_id: string; kind: string }[]).map(
      (r) => `${r.employee_id}|${r.kind}`
    )
  );

  let sent = 0;
  const detalhe: string[] = [];

  for (const { m, late } of devidos) {
    if (m.lunchOnly && !lunchRequired) continue;
    const kind = `${late ? "late" : "pre"}_${m.type}`;
    const { title, body } = late ? lateMessage(m) : preMessage(m);

    for (const employeeId of destinatarios) {
      if (jaFez(employeeId, m.type)) continue;
      if (m.requiresEntrada && !jaFez(employeeId, "entrada")) continue;
      if (jaEnviado.has(`${employeeId}|${kind}`)) continue;

      const payload = JSON.stringify({ title, body, url: "/registo" });
      let delivered = false;
      for (const sub of subsByUser.get(employeeId) ?? []) {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            payload
          );
          delivered = true;
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            // subscrição morta (app reinstalada, permissões retiradas…)
            await admin.from("push_subscriptions").delete().eq("id", sub.id);
          }
        }
      }

      if (delivered) {
        await admin
          .from("reminders_sent")
          .insert({ employee_id: employeeId, entry_date: today, kind });
        sent += 1;
        detalhe.push(kind);
      }
    }
  }

  return NextResponse.json({
    sent,
    relogio,
    avisos: devidos.map((d) => `${d.late ? "late" : "pre"}_${d.m.type}`),
    enviados: detalhe,
    destinatarios: destinatarios.length,
  });
}
