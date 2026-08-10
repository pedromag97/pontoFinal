import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// RGPD — apagar todos os dados de um funcionário:
// fotos no Storage + registos de ponto; opcionalmente a própria conta.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  if (id === session.user.id) {
    return NextResponse.json(
      { error: "Não podes apagar a tua própria conta." },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const deleteAccount = body?.deleteAccount === true;

  const admin = createAdminClient();

  // 1. Apagar fotos do Storage (em lotes — a API aceita listas).
  const { data: entries } = await admin
    .from("time_entries")
    .select("photo_path")
    .eq("employee_id", id)
    .not("photo_path", "is", null);

  const paths = (entries ?? [])
    .map((e) => e.photo_path as string)
    .filter(Boolean);
  for (let i = 0; i < paths.length; i += 100) {
    await admin.storage.from("selfies").remove(paths.slice(i, i + 100));
  }

  // 2. Apagar registos.
  const { error: deleteError } = await admin
    .from("time_entries")
    .delete()
    .eq("employee_id", id);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  // 3. Opcional: apagar a conta (o profile cai por FK cascade).
  if (deleteAccount) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, photosDeleted: paths.length });
}
