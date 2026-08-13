"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getDictionary } from "@/lib/i18n";
import { useDialogs } from "@/components/ui/Dialogs";

const t = getDictionary("pt");

// Marca/desmarca um registo individual como feito em manutenção.
export default function MaintenanceToggle({
  entryId,
  maintenance,
}: {
  entryId: string;
  maintenance: boolean;
}) {
  const router = useRouter();
  const dialogs = useDialogs();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const confirmText = maintenance
      ? t.entries.maintenanceUnmark
      : t.entries.maintenanceMark;
    const ok = await dialogs.confirm({
      title: maintenance ? t.entries.maintenanceOff : t.entries.maintenanceOn,
      message: confirmText,
      confirmLabel: t.worksites.save,
    });
    if (!ok) return;
    setBusy(true);
    const res = await fetch(`/api/admin/entries/${entryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maintenance: !maintenance }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={
        maintenance ? t.entries.maintenanceUnmark : t.entries.maintenanceMark
      }
      className={`rounded-lg border px-2 py-1 text-xs disabled:opacity-50 ${
        maintenance
          ? "border-orange-300 bg-orange-100 text-orange-700"
          : "border-slate-300 text-slate-400 hover:bg-slate-50"
      }`}
    >
      🔧
    </button>
  );
}
