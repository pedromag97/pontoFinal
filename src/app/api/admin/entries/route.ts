import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { lisbonToUtcIso } from "@/lib/format";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const TYPES = ["entrada", "saida_almoco", "volta_almoco", "saida"];

// Criar um registo manual (funcionário esqueceu-se de registar).
// Sem foto/GPS; hora definida pelo admin; o trigger marca flags.manual.
export async function POST(request: Request) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const employeeId =
    typeof body?.employee_id === "string" ? body.employee_id : "";
  const date = typeof body?.date === "string" ? body.date : "";
  const time = typeof body?.time === "string" ? body.time : "";
  const entryType = typeof body?.entry_type === "string" ? body.entry_type : "";

  if (
    !employeeId ||
    !DATE_RE.test(date) ||
    !TIME_RE.test(time) ||
    !TYPES.includes(entryType)
  ) {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("time_entries")
    .insert({
      employee_id: employeeId,
      entry_type: entryType,
      manual: true,
      created_at: lisbonToUtcIso(date, time),
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      {
        error:
          error.code === "23505"
            ? "Já existe um registo desse tipo nesse dia."
            : error.message,
      },
      { status: 400 }
    );
  }

  return NextResponse.json({ id: data.id });
}
