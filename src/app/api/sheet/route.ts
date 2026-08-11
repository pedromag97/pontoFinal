import { NextResponse } from "next/server";
import { getSessionProfile } from "@/lib/auth";
import { buildPresenceSheet } from "@/lib/presenceSheet";
import { concelhoFromCoords } from "@/lib/geocode";
import { createAdminClient } from "@/lib/supabase/admin";
import { monthBounds, monthWorksite } from "@/lib/format";
import type { TimeEntry } from "@/types";

export const runtime = "nodejs";

// Folha de presença mensal em PDF.
// - Funcionário: descarrega a sua (para assinar e enviar à empresa).
// - Admin: descarrega a de qualquer funcionário (?employee=<id>).
export async function GET(request: Request) {
  const session = await getSessionProfile();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { supabase, profile } = session;

  const url = new URL(request.url);
  const monthParam = url.searchParams.get("m") ?? "";
  const month = /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : monthWorksite();

  let employeeId = profile.id;
  let employeeName = profile.full_name;
  let username = profile.username;

  if (profile.role === "admin") {
    const target = url.searchParams.get("employee");
    if (!target) {
      return NextResponse.json({ error: "employee required" }, { status: 400 });
    }
    const { data: targetProfile } = await supabase
      .from("profiles")
      .select("id, full_name, username")
      .eq("id", target)
      .maybeSingle();
    if (!targetProfile) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    employeeId = targetProfile.id;
    employeeName = targetProfile.full_name;
    username = targetProfile.username;
  }

  const { from, to } = monthBounds(month);
  const { data: entries } = await supabase
    .from("time_entries")
    .select("*, worksites(name)")
    .eq("employee_id", employeeId)
    .gte("entry_date", from)
    .lte("entry_date", to)
    .order("created_at");

  const { data: setting } = await supabase
    .from("sheet_settings")
    .select("include_saturdays")
    .eq("employee_id", employeeId)
    .eq("month", month)
    .maybeSingle();

  const entryList = (entries ?? []) as (TimeEntry & {
    worksites: { name: string } | null;
  })[];

  // Local de trabalho no cabeçalho: obra mais frequente do mês.
  const counts = new Map<string, number>();
  for (const entry of entryList) {
    const name = entry.maintenance ? "Manutenção" : entry.worksites?.name;
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const worksiteName =
    [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  // Feriados do mês (geridos na página Feriados do painel).
  const { data: holidayRows } = await supabase
    .from("holidays")
    .select("holiday_date, name")
    .gte("holiday_date", from)
    .lte("holiday_date", to);
  const holidaysByDay: Record<number, string> = {};
  for (const row of holidayRows ?? []) {
    holidaysByDay[Number((row.holiday_date as string).slice(8, 10))] =
      row.name as string;
  }

  // Coluna "Local": concelho do 1.º registo de cada dia (geocode com cache).
  const admin = createAdminClient();
  const firstOfDay = new Map<number, (typeof entryList)[number]>();
  for (const entry of entryList) {
    const day = Number(entry.entry_date.slice(8, 10));
    if (!firstOfDay.has(day)) firstOfDay.set(day, entry); // já vem ordenado
  }
  const localityByDay: Record<number, string> = {};
  for (const [day, entry] of firstOfDay) {
    if (entry.latitude !== null && entry.longitude !== null) {
      const concelho = await concelhoFromCoords(
        admin,
        entry.latitude,
        entry.longitude
      );
      if (concelho) {
        localityByDay[day] = concelho;
        continue;
      }
    }
    // registo manual (sem GPS) ou geocode falhado → nome da obra, se houver
    if (entry.worksites?.name) localityByDay[day] = entry.worksites.name;
  }

  const pdf = await buildPresenceSheet({
    employeeName,
    month,
    worksiteName,
    entries: entryList,
    includeSaturdays: setting?.include_saturdays ?? false,
    holidaysByDay,
    localityByDay,
  });

  const safeName = (username ?? employeeName ?? "funcionario").replace(
    /[^a-zA-Z0-9._-]+/g,
    "_"
  );
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="folha_presenca_${safeName}_${month}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
