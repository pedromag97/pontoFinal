import { NextResponse } from "next/server";
import { getSessionProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushToUser } from "@/lib/serverPush";
import type { EntryType } from "@/types";

export const runtime = "nodejs";

const TIPOS: EntryType[] = ["entrada", "saida_almoco", "volta_almoco", "saida"];

// Aviso do funcionário: "a app não me deixa picar".
//
// Esta rota é a válvula de escape, por isso é deliberadamente pobre em
// requisitos: não precisa de GPS, de foto, de desafio nem de assinatura.
// Só de sessão e de rede. Tudo o que possa estar avariado fica de fora
// do caminho.
export async function POST(request: Request) {
  const session = await getSessionProfile();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { profile } = session;

  const body = await request.json().catch(() => null);
  const entryType = TIPOS.includes(body?.entry_type) ? body.entry_type : null;
  const note =
    typeof body?.note === "string" ? body.note.trim().slice(0, 500) : null;

  const admin = createAdminClient();

  // Contexto recolhido pelo servidor, não pelo cliente: o que interessa
  // saber é se ele tem telemóvel registado e quantas tentativas perdeu —
  // e isso a pessoa não sabe dizer.
  const [{ data: credenciais }, { data: tentativas }] = await Promise.all([
    admin
      .from("webauthn_credentials")
      .select("device_label, device_type, last_used_at")
      .eq("employee_id", profile.id),
    admin
      .from("punch_challenges")
      .select("entry_type, requires_photo, created_at")
      .eq("employee_id", profile.id)
      .is("used_at", null)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const { error } = await admin.from("problem_reports").insert({
    employee_id: profile.id,
    entry_type: entryType,
    note,
    context: {
      // Do telemóvel: o que a app viu falhar, e o estado de GPS/câmara.
      app: typeof body?.context === "object" && body.context ? body.context : {},
      telemovel_registado: (credenciais ?? []).length > 0,
      credencial: (credenciais ?? [])[0] ?? null,
      tentativas_perdidas: tentativas ?? [],
    },
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Avisar a gestão por notificação, se algum admin as tiver ativas.
  const { data: admins } = await admin
    .from("profiles")
    .select("id")
    .eq("role", "admin")
    .eq("active", true);
  let avisados = 0;
  for (const a of (admins ?? []) as { id: string }[]) {
    const ok = await sendPushToUser(admin, a.id, {
      title: "⚠️ App encravada",
      body: `${profile.full_name} não consegue registar${
        entryType ? ` (${entryType.replace("_", " ")})` : ""
      }.${note ? ` "${note}"` : ""}`,
      url: "/admin/registos",
    });
    if (ok) avisados += 1;
  }

  return NextResponse.json({ ok: true, avisados });
}
