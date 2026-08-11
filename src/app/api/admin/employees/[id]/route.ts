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

  const admin = createAdminClient();

  const updates: Record<string, unknown> = {};
  if (typeof body.full_name === "string" && body.full_name.trim()) {
    updates.full_name = body.full_name.trim();
  }
  if (typeof body.active === "boolean") {
    updates.active = body.active;
  }
  if (typeof body.maintenance_team === "boolean") {
    updates.maintenance_team = body.maintenance_team;
  }

  if (Object.keys(updates).length > 0) {
    const { error } = await admin.from("profiles").update(updates).eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
  }

  // Ao marcar como manutenção, limpa retroativamente os "Fora da obra"
  // desse funcionário — o backoffice associa a equipa depois dos registos.
  if (body.maintenance_team === true) {
    const { data: flagged } = await admin
      .from("time_entries")
      .select("id, flags")
      .eq("employee_id", id)
      .contains("flags", { out_of_area: true });
    for (const entry of flagged ?? []) {
      const flags = { ...(entry.flags as Record<string, boolean>) };
      delete flags.out_of_area;
      await admin.from("time_entries").update({ flags }).eq("id", entry.id);
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
