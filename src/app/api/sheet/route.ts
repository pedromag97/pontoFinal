import { NextResponse } from "next/server";
import { getSessionProfile } from "@/lib/auth";
import { buildPresenceSheet } from "@/lib/presenceSheet";
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

  // Local de trabalho no cabeçalho: obra mais frequente do mês.
  const counts = new Map<string, number>();
  for (const entry of (entries ?? []) as (TimeEntry & {
    worksites: { name: string } | null;
  })[]) {
    const name = entry.maintenance ? "Manutenção" : entry.worksites?.name;
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const worksiteName =
    [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const pdf = await buildPresenceSheet({
    employeeName,
    month,
    worksiteName,
    entries: (entries ?? []) as TimeEntry[],
    includeSaturdays: setting?.include_saturdays ?? false,
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
