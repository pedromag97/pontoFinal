import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";

// Invalidar as páginas do back-office depois de uma alteração.
//
// router.refresh() só volta a buscar a página ONDE se está. Quem edita um
// registo em Registos e depois vai à Grelha — ou volta atrás no browser —
// continua a ver os números antigos, porque o Next guarda a versão
// anterior dessa rota no cliente. Isto limpa a árvore /admin toda.
export async function POST() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  revalidatePath("/admin", "layout");
  return NextResponse.json({ ok: true });
}
