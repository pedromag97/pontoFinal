import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const RETENTION_MONTHS = 3;

// Retenção RGPD: apaga do Storage as fotos com mais de 3 meses e limpa
// photo_path nos registos (as horas/GPS mantêm-se para os salários).
// - POST: chamado pelo botão no painel admin.
// - GET:  chamado pelo cron da Vercel (Authorization: Bearer CRON_SECRET).
async function applyRetention() {
  const admin = createAdminClient();
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - RETENTION_MONTHS);
  const cutoffIso = cutoff.toISOString();

  const { data: entries, error } = await admin
    .from("time_entries")
    .select("id, photo_path")
    .lt("created_at", cutoffIso)
    .not("photo_path", "is", null)
    .limit(2000);
  if (error) throw new Error(error.message);

  const list = entries ?? [];
  const paths = list.map((e) => e.photo_path as string);

  for (let i = 0; i < paths.length; i += 100) {
    await admin.storage.from("selfies").remove(paths.slice(i, i + 100));
  }

  for (const entry of list) {
    await admin
      .from("time_entries")
      .update({ photo_path: null, flags: { photo_purged: true } })
      .eq("id", entry.id);
  }

  return list.length;
}

export async function POST() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const purged = await applyRetention();
    return NextResponse.json({ purged });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const purged = await applyRetention();
    return NextResponse.json({ purged });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
