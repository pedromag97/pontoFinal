import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// Criar conta de funcionário. Usa a service_role key (só no servidor),
// depois de confirmar que quem chama é admin ativo.
export async function POST(request: Request) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const fullName =
    typeof body?.full_name === "string" ? body.full_name.trim() : "";

  if (!email || !fullName || password.length < 8) {
    return NextResponse.json(
      { error: "Dados inválidos (password mín. 8 caracteres)." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, role: "employee" },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // O trigger handle_new_user cria o profile; garante o nome mesmo assim.
  await admin
    .from("profiles")
    .update({ full_name: fullName })
    .eq("id", data.user.id);

  return NextResponse.json({ id: data.user.id });
}
