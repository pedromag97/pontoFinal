import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

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
