"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getDictionary } from "@/lib/i18n";

const t = getDictionary("pt");

// Arruma um aviso de "a app não me deixa registar".
export default function ResolveReportButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function resolver() {
    setBusy(true);
    const supabase = createClient();
    // Guardar quem resolveu: um aviso destes costuma dar origem a
    // registos criados à mão, e convém saber a quem perguntar depois.
    const { data: sessao } = await supabase.auth.getUser();
    await supabase
      .from("problem_reports")
      .update({
        resolved_at: new Date().toISOString(),
        resolved_by: sessao.user?.id ?? null,
      })
      .eq("id", id);
    setBusy(false);
    router.refresh();
  }

  return (
    <button
      onClick={resolver}
      disabled={busy}
      className="text-xs font-semibold text-red-800 underline underline-offset-2 hover:text-red-950 disabled:opacity-50"
    >
      {t.entries.reportResolve}
    </button>
  );
}
