"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { atualizarAdmin } from "@/lib/adminRefresh";
import { getDictionary } from "@/lib/i18n";
import { useDialogs } from "@/components/ui/Dialogs";
import { pedir } from "@/lib/pedir";

const t = getDictionary("pt");

// Marca/desmarca um registo como conferido pelo backoffice.
export default function ValidateToggle({
  entryId,
  validated,
  auto = false,
}: {
  entryId: string;
  validated: boolean;
  auto?: boolean;
}) {
  const router = useRouter();
  const dialogs = useDialogs();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    const res = await pedir(`/api/admin/entries/${entryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ validated: !validated }),
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

  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={
        validated
          ? `${auto ? t.entries.validatedAuto : t.entries.validated} — ${t.entries.unvalidateOne}`
          : `${t.entries.pendingValidation} — ${t.entries.validateOne}`
      }
      className={`rounded-lg border px-2 py-1 text-xs font-bold disabled:opacity-50 ${
        validated
          ? "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700"
          : "border-slate-300 text-slate-400 hover:bg-slate-50"
      }`}
    >
      {auto && validated ? "✓⚙" : "✓"}
    </button>
  );
}
