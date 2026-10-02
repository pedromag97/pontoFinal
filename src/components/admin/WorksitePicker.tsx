"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { atualizarAdmin } from "@/lib/adminRefresh";
import { getDictionary } from "@/lib/i18n";
import { useDialogs } from "@/components/ui/Dialogs";
import type { Worksite } from "@/types";
import { pedir } from "@/lib/pedir";

const t = getDictionary("pt");

// Obra de um registo. Normalmente vem do raio da obra fixa; quando o
// registo cai fora (equipas com zonas grandes, obras móveis), o backoffice
// escolhe-a aqui — o que resolve o aviso "fora da obra".
export default function WorksitePicker({
  entryId,
  worksiteId,
  worksites,
  automatic,
}: {
  entryId: string;
  worksiteId: string | null;
  worksites: Worksite[];
  automatic: boolean;
}) {
  const router = useRouter();
  const dialogs = useDialogs();
  const [busy, setBusy] = useState(false);

  async function escolher(novo: string) {
    setBusy(true);
    const res = await pedir(`/api/admin/entries/${entryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ worksite_id: novo || null }),
    });
    setBusy(false);
    if (!res.ok) {
      // Mostrar a falha: antes isto não fazia nada, e a pessoa ficava a
      // achar que a alteração tinha entrado.
      const corpo = await res.json().catch(() => ({}));
      await dialogs.alert({
        title: t.entries.saveFailed,
        message: corpo.error ?? t.employees.error,
      });
      return;
    }
    await atualizarAdmin(router);
  }

  // Obra detetada pelo GPS: mostra-se como texto, sem sugerir edição.
  if (automatic) {
    const nome = worksites.find((w) => w.id === worksiteId)?.name;
    return (
      <span
        className="whitespace-nowrap text-slate-600"
        title={t.entries.worksiteAuto}
      >
        {nome ?? "—"}
      </span>
    );
  }

  return (
    <select
      value={worksiteId ?? ""}
      disabled={busy}
      onChange={(e) => escolher(e.target.value)}
      title={t.entries.worksitePick}
      className={`max-w-32 rounded-lg border px-1.5 py-1 text-xs disabled:opacity-50 ${
        worksiteId
          ? "border-slate-300 text-slate-700"
          : "border-amber-300 bg-amber-50 text-amber-800"
      }`}
    >
      <option value="">{t.entries.worksiteNone}</option>
      {worksites
        .filter((w) => w.active || w.id === worksiteId)
        .map((w) => (
          <option key={w.id} value={w.id}>
            {w.mobile ? `${w.name} ⇄` : w.name}
          </option>
        ))}
    </select>
  );
}
