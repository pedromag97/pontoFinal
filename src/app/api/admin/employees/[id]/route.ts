import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// Editar funcionário: nome, ativo/desativado, nova password.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  // Um admin não se pode desativar a si próprio (evita lock-out).
  if (body.active === false && id === session.user.id) {
    return NextResponse.json(
      { error: "Não podes desativar a tua própria conta." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const updates: Record<string, unknown> = {};
  if (typeof body.full_name === "string" && body.full_name.trim()) {
    updates.full_name = body.full_name.trim();
  }
  if (typeof body.active === "boolean") {
    updates.active = body.active;
  }

  if (Object.keys(updates).length > 0) {
    const { error } = await admin.from("profiles").update(updates).eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
  }

  if (typeof body.password === "string" && body.password.length >= 8) {
    const { error } = await admin.auth.admin.updateUserById(id, {
      password: body.password,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
  }

  return NextResponse.json({ ok: true });
}
