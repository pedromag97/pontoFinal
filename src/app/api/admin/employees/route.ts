import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { loginToEmail, normalizeLogin, USERNAME_RE } from "@/lib/username";

// Criar conta de funcionário. Usa a service_role key (só no servidor),
// depois de confirmar que quem chama é admin ativo.
// O login pode ser um username (mapeado para um email interno) ou um email.
export async function POST(request: Request) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const login = normalizeLogin(
    typeof body?.login === "string" ? body.login : ""
  );
  const password = typeof body?.password === "string" ? body.password : "";
  const fullName =
    typeof body?.full_name === "string" ? body.full_name.trim() : "";

  if (!login || !fullName || password.length < 8) {
    return NextResponse.json(
      { error: "Dados inválidos (password mín. 8 caracteres)." },
      { status: 400 }
    );
  }

  const isEmail = login.includes("@");
  if (!isEmail && !USERNAME_RE.test(login)) {
    return NextResponse.json(
      {
        error:
          "Username inválido: 3–30 caracteres, minúsculas, números, ponto, hífen ou underscore.",
      },
      { status: 400 }
    );
  }
  const username = isEmail ? null : login;
  const email = loginToEmail(login);

  const admin = createAdminClient();

  if (username) {
    const { data: existing } = await admin
      .from("profiles")
      .select("id")
      .eq("username", username)
      .maybeSingle();
    if (existing) {
      return NextResponse.json(
        { error: `O username "${username}" já existe.` },
        { status: 400 }
      );
    }
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, role: "employee", username },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // O trigger handle_new_user cria o profile; garante os campos mesmo assim.
  await admin
    .from("profiles")
    .update({ full_name: fullName, username })
    .eq("id", data.user.id);

  return NextResponse.json({ id: data.user.id, username });
}
