import { NextResponse } from "next/server";
import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayWorksite, WORKSITE_TZ } from "@/lib/format";
import type { EntryType } from "@/types";

export const runtime = "nodejs";

// Lembretes push, verificados de 15 em 15 min por pg_cron (Supabase):
//  - volta_almoco: saiu para almoço há mais de VOLTA_AFTER_H e não voltou;
//  - saida: entrou há mais de SAIDA_AFTER_H e não registou a saída.
// Cada lembrete é enviado no máximo 1x por funcionário por dia.
const VOLTA_AFTER_H = 2;
const SAIDA_AFTER_H = 9;
const QUIET_BEFORE = 8; // sem notificações fora de 08h–22h (Lisboa)
const QUIET_AFTER = 22;

const MESSAGES: Record<string, { title: string; body: string }> = {
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

  const hour = parseInt(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: WORKSITE_TZ,
      hour: "2-digit",
      hour12: false,
    }).format(new Date()),
    10
  );
  if (hour < QUIET_BEFORE || hour >= QUIET_AFTER) {
    return NextResponse.json({ sent: 0, skipped: "quiet hours" });
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:noreply@ponto.lusocabo.com",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  const admin = createAdminClient();
  const today = todayWorksite();
  const now = Date.now();

  const { data, error } = await admin
    .from("time_entries")
    .select("employee_id, entry_type, created_at")
    .eq("entry_date", today);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const byEmployee = new Map<string, EntryRow[]>();
  for (const row of (data ?? []) as EntryRow[]) {
    if (!byEmployee.has(row.employee_id)) byEmployee.set(row.employee_id, []);
    byEmployee.get(row.employee_id)!.push(row);
  }

  // Que lembrete (se algum) deve cada funcionário receber agora?
  const due: { employeeId: string; kind: string }[] = [];
  for (const [employeeId, rows] of byEmployee) {
    const get = (t: EntryType) => rows.find((r) => r.entry_type === t);
    if (get("saida")) continue; // dia fechado

    const saidaAlmoco = get("saida_almoco");
    const entrada = get("entrada");
    const hoursSince = (iso: string) =>
      (now - new Date(iso).getTime()) / 3600000;

    if (
      saidaAlmoco &&
      !get("volta_almoco") &&
      hoursSince(saidaAlmoco.created_at) >= VOLTA_AFTER_H
    ) {
      due.push({ employeeId, kind: "volta_almoco" });
    } else if (entrada && hoursSince(entrada.created_at) >= SAIDA_AFTER_H) {
      due.push({ employeeId, kind: "saida" });
    }
  }

  let sent = 0;
  for (const { employeeId, kind } of due) {
    // já enviado hoje?
    const { data: already } = await admin
      .from("reminders_sent")
      .select("kind")
      .eq("employee_id", employeeId)
      .eq("entry_date", today)
      .eq("kind", kind)
      .maybeSingle();
    if (already) continue;

    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", employeeId);
    if (!subs || subs.length === 0) continue;

    const payload = JSON.stringify({ ...MESSAGES[kind], url: "/registo" });
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
        .insert({ employee_id: employeeId, entry_date: today, kind });
      sent += 1;
    }
  }

  return NextResponse.json({ sent, checked: byEmployee.size });
}
