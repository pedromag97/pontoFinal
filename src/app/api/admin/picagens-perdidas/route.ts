import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Arrumar as picagens tentadas e não concluídas: marcar como vistas, ou
// repor uma que se marcou por engano.
//
// Passa pelo servidor porque punch_challenges não tem (nem deve ter)
// escrita pelo cliente — quem cria e consome os desafios é a rota de
// registo, e abrir a escrita a admins dava-lhes forma de mexer em
// desafios ainda por usar.
export async function POST(request: Request) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.ids) ? (body.ids as unknown[]) : [];
  const repor = body?.repor === true;

  const limpos = ids.filter(
    (id): id is string => typeof id === "string" && UUID_RE.test(id)
  );
  if (limpos.length === 0) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error, count } = await admin
    .from("punch_challenges")
    .update(
      repor
        ? { dismissed_at: null, dismissed_by: null }
        : {
            dismissed_at: new Date().toISOString(),
            dismissed_by: session.user.id,
          },
      { count: "exact" }
    )
    .in("id", limpos)
    // Nunca tocar num desafio que deu registo: esses não são avisos.
    .is("used_at", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, alteradas: count ?? 0 });
}
