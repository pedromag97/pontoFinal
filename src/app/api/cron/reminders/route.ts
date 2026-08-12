import { NextResponse } from "next/server";
import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayWorksite, weekdayWorksite, WORKSITE_TZ } from "@/lib/format";
import type { EntryType } from "@/types";

export const runtime = "nodejs";

// Lembretes push, verificados de 5 em 5 min por pg_cron (Supabase).
// Dois tipos, cada um enviado no máx. 1x por funcionário por dia:
//
// 1. PRÉ-HORÁRIO — 5 min antes de cada hora do horário normal
//    (08h–12h / 13h–17h, hora de Portugal), Seg–Sáb exceto feriados;
//    os do almoço só nos dias com almoço obrigatório configurado.
//    Só recebe quem ainda não fez esse registo.
//
// 2. ESQUECIMENTO — rede de segurança depois da hora:
//    volta_almoco: saiu para almoço há 2h+ e não registou a volta;
//    saida: entrou há 9h+ e não registou a saída.
const VOLTA_AFTER_H = 2;
const SAIDA_AFTER_H = 9;
const QUIET_BEFORE = 8; // esquecimento: sem notificações fora de 08h–22h
const QUIET_AFTER = 22;

interface PreTarget {
  kind: string;
  type: EntryType;
  minutes: number; // hora-alvo em minutos (Lisboa)
  lunchOnly: boolean; // só em dias com almoço obrigatório
  requiresEntrada: boolean; // só para quem já registou entrada hoje
  title: string;
  body: string;
}

const PRE_TARGETS: PreTarget[] = [
  {
    kind: "pre_entrada",
    type: "entrada",
    minutes: 8 * 60,
    lunchOnly: false,
    requiresEntrada: false,
    title: "Entrada às 08:00 ⏰",
    body: "Bom dia! Não te esqueças de registar a entrada quando chegares.",
  },
  {
    kind: "pre_saida_almoco",
    type: "saida_almoco",
    minutes: 12 * 60,
    lunchOnly: true,
    requiresEntrada: true,
    title: "Saída para almoço às 12:00 🍽️",
    body: "Regista a saída para almoço antes da pausa.",
  },
  {
    kind: "pre_volta_almoco",
    type: "volta_almoco",
    minutes: 13 * 60,
    lunchOnly: true,
    requiresEntrada: true,
    title: "Volta do almoço às 13:00 🔨",
    body: "Regista o regresso do almoço quando voltares ao trabalho.",
  },
  {
    kind: "pre_saida",
    type: "saida",
    minutes: 17 * 60,
    lunchOnly: false,
    requiresEntrada: true,
    title: "Saída às 17:00 🌇",
    body: "Não te esqueças de registar a saída antes de ir embora.",
  },
];

const FORGOT_MESSAGES: Record<string, { title: string; body: string }> = {
  volta_almoco: {
    title: "Volta do almoço 🍽️",
    body: "Esqueceste-te de registar a volta do almoço? Abre a app e regista.",
  },
  saida: {
    title: "Registo de saída 🌇",
    body: "Não te esqueças de registar a saída antes de ir embora!",
  },
};

interface EntryRow {
  employee_id: string;
  entry_type: EntryType;
  created_at: string;
}

interface Subscription {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
  const now = Date.now();

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: WORKSITE_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date())
    .split(":");
  const hour = parseInt(parts[0], 10);
  const nowMinutes = hour * 60 + parseInt(parts[1], 10);

  // Subscrições agrupadas por funcionário (quem não ativou, não recebe).
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
    return NextResponse.json({ sent: 0, skipped: "no subscriptions" });
  }

  // Registos de hoje, agrupados por funcionário.
  const { data: entriesData, error: entriesError } = await admin
    .from("time_entries")
    .select("employee_id, entry_type, created_at")
    .eq("entry_date", today);
  if (entriesError) {
    return NextResponse.json({ error: entriesError.message }, { status: 500 });
  }
  const entriesByEmployee = new Map<string, EntryRow[]>();
  for (const row of (entriesData ?? []) as EntryRow[]) {
    if (!entriesByEmployee.has(row.employee_id)) {
      entriesByEmployee.set(row.employee_id, []);
    }
    entriesByEmployee.get(row.employee_id)!.push(row);
  }

  const has = (employeeId: string, type: EntryType) =>
    (entriesByEmployee.get(employeeId) ?? []).some(
      (r) => r.entry_type === type
    );

  // Lembretes a enviar neste tick: { employeeId, kind, title, body }.
  const due: { employeeId: string; kind: string; title: string; body: string }[] =
    [];

  // ---------- 1. PRÉ-HORÁRIO ----------
  const activePreTargets = PRE_TARGETS.filter(
    (target) =>
      nowMinutes >= target.minutes - 5 && nowMinutes < target.minutes
  );
  if (activePreTargets.length > 0 && weekday !== 0) {
    const { data: holiday } = await admin
      .from("holidays")
      .select("holiday_date")
      .eq("holiday_date", today)
      .maybeSingle();

    if (!holiday) {
      const { data: schedule } = await admin
        .from("lunch_schedule")
        .select("lunch_required")
        .eq("weekday", weekday)
        .maybeSingle();
      const lunchRequired = schedule?.lunch_required ?? false;

      // Só funcionários ativos recebem.
      const { data: activeEmployees } = await admin
        .from("profiles")
        .select("id")
        .eq("role", "employee")
        .eq("active", true);
      const activeIds = new Set(
        (activeEmployees ?? []).map((p) => p.id as string)
      );

      for (const target of activePreTargets) {
        if (target.lunchOnly && !lunchRequired) continue;
        for (const employeeId of subsByUser.keys()) {
          if (!activeIds.has(employeeId)) continue;
          if (has(employeeId, target.type)) continue; // já registou
          if (target.requiresEntrada && !has(employeeId, "entrada")) continue;
          due.push({
            employeeId,
            kind: target.kind,
            title: target.title,
            body: target.body,
          });
        }
      }
    }
  }

  // ---------- 2. ESQUECIMENTO ----------
  if (hour >= QUIET_BEFORE && hour < QUIET_AFTER) {
    const hoursSince = (iso: string) =>
      (now - new Date(iso).getTime()) / 3600000;
    for (const [employeeId, rows] of entriesByEmployee) {
      if (!subsByUser.has(employeeId)) continue;
      const get = (t: EntryType) => rows.find((r) => r.entry_type === t);
      if (get("saida")) continue; // dia fechado

      const saidaAlmoco = get("saida_almoco");
      const entrada = get("entrada");
      if (
        saidaAlmoco &&
        !get("volta_almoco") &&
        hoursSince(saidaAlmoco.created_at) >= VOLTA_AFTER_H
      ) {
        due.push({ employeeId, kind: "volta_almoco", ...FORGOT_MESSAGES.volta_almoco });
      } else if (entrada && hoursSince(entrada.created_at) >= SAIDA_AFTER_H) {
        due.push({ employeeId, kind: "saida", ...FORGOT_MESSAGES.saida });
      }
    }
  }

  // ---------- envio (com deduplicação por dia/tipo) ----------
  let sent = 0;
  for (const item of due) {
    const { data: already } = await admin
      .from("reminders_sent")
      .select("kind")
      .eq("employee_id", item.employeeId)
      .eq("entry_date", today)
      .eq("kind", item.kind)
      .maybeSingle();
    if (already) continue;

    const subs = subsByUser.get(item.employeeId) ?? [];
    const payload = JSON.stringify({
      title: item.title,
      body: item.body,
      url: "/registo",
    });
    let delivered = false;
    for (const sub of subs) {
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
        .insert({ employee_id: item.employeeId, entry_date: today, kind: item.kind });
      sent += 1;
    }
  }

  return NextResponse.json({
    sent,
    subscribers: subsByUser.size,
    window: `${String(hour).padStart(2, "0")}:${String(nowMinutes % 60).padStart(2, "0")}`,
  });
}
