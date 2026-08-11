import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSuspicious } from "@/lib/entries";
import type { TimeEntry } from "@/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Validação em massa dos registos de um filtro (mesmo filtro da tabela).
// mode "clean": valida apenas os registos sem avisos, deixando os suspeitos
// para revisão individual. mode "all": valida tudo o que o filtro devolve.
export async function POST(request: Request) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const from = DATE_RE.test(body?.from ?? "") ? body.from : null;
  const to = DATE_RE.test(body?.to ?? "") ? body.to : null;
  if (!from || !to) {
    return NextResponse.json({ error: "invalid range" }, { status: 400 });
  }
  const employee = typeof body?.employee === "string" ? body.employee : "";
  const mode = body?.mode === "all" ? "all" : "clean";
  const validated = body?.validated !== false;

  const admin = createAdminClient();

  let query = admin
    .from("time_entries")
    .select("*")
    .gte("entry_date", from)
    .lte("entry_date", to);
  if (employee) query = query.eq("employee_id", employee);
  if (validated) query = query.is("validated_at", null);
  else query = query.not("validated_at", "is", null);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const targets = ((data ?? []) as TimeEntry[]).filter(
    (entry) => mode === "all" || !isSuspicious(entry)
  );
  if (targets.length === 0) {
    return NextResponse.json({ count: 0 });
  }

  const update = validated
    ? { validated_at: new Date().toISOString(), validated_by: session.user.id }
    : { validated_at: null, validated_by: null };

  const ids = targets.map((entry) => entry.id);
  for (let i = 0; i < ids.length; i += 200) {
    const { error: updateError } = await admin
      .from("time_entries")
      .update(update)
      .in("id", ids.slice(i, i + 200));
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ count: ids.length });
}
