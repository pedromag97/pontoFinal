import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { lisbonToUtcIso } from "@/lib/format";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Editar um registo:
// - maintenance: marcar/desmarcar como manutenção (out_of_area deixa de contar);
// - time "HH:MM": corrigir a hora (fica sinalizado flags.manual_edit).
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
  const admin = createAdminClient();

  if (typeof body?.maintenance === "boolean") {
    const { error } = await admin
      .from("time_entries")
      .update({ maintenance: body.maintenance })
      .eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (typeof body?.time === "string") {
    if (!TIME_RE.test(body.time)) {
      return NextResponse.json({ error: "Hora inválida." }, { status: 400 });
    }
    const { data: entry } = await admin
      .from("time_entries")
      .select("entry_date, flags, created_at")
      .eq("id", id)
      .maybeSingle();
    if (!entry) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const flags = {
      ...(entry.flags as Record<string, unknown>),
      manual_edit: true,
    };
    const { error } = await admin
      .from("time_entries")
      .update({
        created_at: lisbonToUtcIso(entry.entry_date as string, body.time),
        flags,
      })
      .eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "invalid body" }, { status: 400 });
}

// Apagar um registo de ponto (e a respetiva foto no Storage).
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const admin = createAdminClient();

  const { data: entry, error: fetchError } = await admin
    .from("time_entries")
    .select("id, photo_path")
    .eq("id", id)
    .maybeSingle();
  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!entry) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (entry.photo_path) {
    await admin.storage.from("selfies").remove([entry.photo_path]);
  }

  const { error: deleteError } = await admin
    .from("time_entries")
    .delete()
    .eq("id", id);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
