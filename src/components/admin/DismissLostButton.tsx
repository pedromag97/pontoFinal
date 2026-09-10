"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getDictionary } from "@/lib/i18n";
import { useDialogs } from "@/components/ui/Dialogs";

const t = getDictionary("pt");

// Arruma picagens perdidas: marca como vistas ou repõe as que já foram.
// Recebe os ids do grupo — uma linha do painel pode juntar várias
// tentativas seguidas do mesmo movimento.
export default function DismissLostButton({
  ids,
  linhas,
  repor = false,
  todas = false,
}: {
  ids: string[];
  /** Quantas linhas o painel mostra. Os ids são mais: uma linha junta
   *  as tentativas seguidas do mesmo movimento, e a confirmação tem de
   *  falar do que se vê, não do que está por baixo. */
  linhas?: number;
  /** Desfazer: volta a mostrar no painel. */
  repor?: boolean;
  /** Botão de "marcar todas" no cabeçalho, com confirmação. */
  todas?: boolean;
}) {
  const router = useRouter();
  const dialogs = useDialogs();
  const [busy, setBusy] = useState(false);

  async function acionar() {
    if (todas) {
      const ok = await dialogs.confirm({
        title: t.entries.lostDismissAll,
        message: t.entries.lostDismissAllConfirm.replace(
          "{n}",
          String(linhas ?? ids.length)
        ),
        confirmLabel: t.entries.lostDismiss,
      });
      if (!ok) return;
    }

    setBusy(true);
    const res = await fetch("/api/admin/picagens-perdidas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, repor }),
    });
    setBusy(false);
    if (!res.ok) {
      await dialogs.alert({
        title: t.entries.lostDismiss,
        message: t.employees.error,
      });
      return;
    }
    router.refresh();
  }

  return (
    <button
      onClick={acionar}
      disabled={busy}
      className={
        todas
          ? "rounded-xl border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
          : "text-xs font-semibold text-amber-800 underline underline-offset-2 hover:text-amber-950 disabled:opacity-50"
      }
    >
      {repor ? t.entries.lostRestore : todas ? t.entries.lostDismissAll : t.entries.lostDismiss}
    </button>
  );
}
