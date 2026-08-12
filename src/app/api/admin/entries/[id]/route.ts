import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { lisbonToUtcIso } from "@/lib/format";
import { sendPushToUser } from "@/lib/serverPush";
import type { EntryType } from "@/types";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const TYPE_LABEL: Record<EntryType, string> = {
  entrada: "Entrada",
  saida_almoco: "Saída para almoço",
  volta_almoco: "Volta do almoço",
  saida: "Saída",
};

// Editar um registo:
// - maintenance: marcar/desmarcar como manutenção (out_of_area deixa de contar);
// - time "HH:MM": corrigir a hora (fica sinalizado flags.manual_edit);
// - reject + reason: recusar com motivo (o funcionário é notificado e
//   regista de novo); unreject: anular a recusa.
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

  if (typeof body?.validated === "boolean") {
    const { error } = await admin
      .from("time_entries")
      .update(
        body.validated
          ? {
              validated_at: new Date().toISOString(),
              validated_by: session.user.id,
            }
          : { validated_at: null, validated_by: null }
      )
      .eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

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

  if (body?.reject === true) {
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason) {
      return NextResponse.json(
        { error: "A recusa precisa de um motivo." },
        { status: 400 }
      );
    }
    const { data: entry } = await admin
      .from("time_entries")
      .select("id, employee_id, entry_type, entry_date, rejected_at")
      .eq("id", id)
      .maybeSingle();
    if (!entry) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const { error } = await admin
      .from("time_entries")
      .update({
        rejected_at: new Date().toISOString(),
        rejected_by: session.user.id,
        rejection_reason: reason,
        validated_at: null,
        validated_by: null,
      })
      .eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Notificar o funcionário para registar de novo (se tiver push ativo).
    const dateLabel = `${(entry.entry_date as string).slice(8, 10)}/${(entry.entry_date as string).slice(5, 7)}`;
    const notified = await sendPushToUser(admin, entry.employee_id as string, {
      title: "Registo recusado ❌",
      body: `${TYPE_LABEL[entry.entry_type as EntryType]} de ${dateLabel} recusada: ${reason}. Por favor regista de novo.`,
    });

    return NextResponse.json({ ok: true, notified });
  }

  if (body?.unreject === true) {
    const { error } = await admin
      .from("time_entries")
      .update({ rejected_at: null, rejected_by: null, rejection_reason: null })
      .eq("id", id);
    if (error) {
      // 23505: já existe um novo registo do mesmo tipo nesse dia
      if (error.code === "23505") {
        return NextResponse.json(
          {
            error:
              "Não é possível anular: o funcionário já fez um novo registo deste tipo nesse dia.",
          },
          { status: 409 }
        );
      }
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
