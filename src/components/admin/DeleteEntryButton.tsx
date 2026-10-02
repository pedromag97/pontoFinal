"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { atualizarAdmin } from "@/lib/adminRefresh";
import { getDictionary } from "@/lib/i18n";
import { useDialogs } from "@/components/ui/Dialogs";
import { pedir } from "@/lib/pedir";

const t = getDictionary("pt");

export default function DeleteEntryButton({ entryId }: { entryId: string }) {
  const router = useRouter();
  const dialogs = useDialogs();
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    const ok = await dialogs.confirm({
      title: t.entries.delete,
      message: t.entries.deleteConfirm,
      confirmLabel: t.entries.delete,
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    const res = await pedir(`/api/admin/entries/${entryId}`, {
      method: "DELETE",
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
      onClick={handleDelete}
      disabled={busy}
      title={t.entries.delete}
      className="rounded-lg border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
    >
      🗑
    </button>
  );
}
