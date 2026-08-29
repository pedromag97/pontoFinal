import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushToUser } from "@/lib/serverPush";

export const runtime = "nodejs";

// Avisa quem ainda não registou o telemóvel. Sem telemóvel registado, a
// política exige selfie em todas as picagens — e quem dispensou o convite
// nem sempre percebe que é isso que lhe está a acontecer.
//
// Só notifica quem falta: quem já registou não é incomodado.
export async function POST() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  const [{ data: perfis }, { data: credenciais }] = await Promise.all([
    admin
      .from("profiles")
      .select("id, full_name")
      .eq("role", "employee")
      .eq("active", true)
      .order("full_name"),
    admin.from("webauthn_credentials").select("employee_id"),
  ]);

  const comTelemovel = new Set(
    ((credenciais ?? []) as { employee_id: string }[]).map((c) => c.employee_id)
  );
  const emFalta = ((perfis ?? []) as { id: string; full_name: string }[]).filter(
    (p) => !comTelemovel.has(p.id)
  );

  const enviados: string[] = [];
  // Sem subscrição de notificações não há como lhes chegar pela app: a
  // gestão tem de falar com estes diretamente, por isso vão nomeados.
  const semNotificacoes: string[] = [];

  for (const p of emFalta) {
    const ok = await sendPushToUser(admin, p.id, {
      title: "👆 Regista o teu telemóvel",
      body:
        "Passas a picar com a impressão digital, sem tirar selfie de cada " +
        'vez. Abre a app e carrega em "Registar telemóvel — picar sem selfie".',
    });
    (ok ? enviados : semNotificacoes).push(p.full_name);
  }

  return NextResponse.json({
    enviados,
    semNotificacoes,
    emFalta: emFalta.length,
  });
}
