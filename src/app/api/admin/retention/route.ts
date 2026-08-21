import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const RETENTION_MONTHS = 3;
// Margem antes de considerar uma foto órfã: nunca apagar nada que possa
// pertencer a uma picagem ainda a decorrer ou a um registo offline por
// sincronizar (a fila local aceita até 7 dias).
const DIAS_ATE_ORFA = 10;

type Admin = ReturnType<typeof createAdminClient>;

// Fotos no bucket que nenhum registo refere. Acontecem quando a picagem
// é interrompida depois de a foto subir — a digital é cancelada, a rede
// cai — e a purga normal nunca lhes chega, porque essa anda pelos
// registos e estas não têm registo nenhum.
async function limparSelfiesOrfas(admin: Admin): Promise<number> {
  const { data: usadas } = await admin
    .from("time_entries")
    .select("photo_path")
    .not("photo_path", "is", null);
  const referidas = new Set(
    (usadas ?? []).map((e) => e.photo_path as string)
  );

  // O bucket está organizado por pasta de funcionário.
  const { data: pastas } = await admin.storage.from("selfies").list("", {
    limit: 1000,
  });
  const limite = Date.now() - DIAS_ATE_ORFA * 24 * 60 * 60 * 1000;
  const aApagar: string[] = [];

  for (const pasta of pastas ?? []) {
    // Entradas com id são ficheiros à raiz, não pastas de funcionário.
    if (pasta.id) continue;
    let pagina = 0;
    for (;;) {
      const { data: ficheiros } = await admin.storage
        .from("selfies")
        .list(pasta.name, { limit: 100, offset: pagina * 100 });
      if (!ficheiros || ficheiros.length === 0) break;
      for (const f of ficheiros) {
        const caminho = `${pasta.name}/${f.name}`;
        if (referidas.has(caminho)) continue;
        const criado = new Date(f.created_at ?? 0).getTime();
        if (criado && criado < limite) aApagar.push(caminho);
      }
      if (ficheiros.length < 100) break;
      pagina += 1;
    }
  }

  for (let i = 0; i < aApagar.length; i += 100) {
    await admin.storage.from("selfies").remove(aApagar.slice(i, i + 100));
  }
  return aApagar.length;
}

// Desafios de picagem: cada tentativa cria uma linha e nada as apagava.
// Duram 5 minutos, por isso tudo o que tenha mais de um dia é lixo.
async function limparDesafiosAntigos(admin: Admin): Promise<number> {
  const ontem = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await admin
    .from("punch_challenges")
    .delete({ count: "exact" })
    .lt("created_at", ontem);
  if (error) {
    console.error("[retencao] limpeza de desafios falhou:", error.message);
    return 0;
  }
  return count ?? 0;
}

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
    .select("id, photo_path, flags")
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
      .update({
        photo_path: null,
        // Juntar, não substituir: escrever só { photo_purged } apagava os
        // avisos (GPS impreciso, relógio, fora da obra) precisamente nos
        // registos antigos, que é quando a foto já não existe para os
        // confirmar. O rasto tem de sobreviver à foto.
        flags: {
          ...((entry.flags as Record<string, unknown>) ?? {}),
          photo_purged: true,
        },
      })
      .eq("id", entry.id);
  }

  const orfas = await limparSelfiesOrfas(admin);
  const desafios = await limparDesafiosAntigos(admin);

  return { purged: list.length, orfas, desafios };
}

export async function POST() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    return NextResponse.json(await applyRetention());
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
    return NextResponse.json(await applyRetention());
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
