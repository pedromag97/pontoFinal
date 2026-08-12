"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getDictionary } from "@/lib/i18n";

const t = getDictionary("pt");

// Marca/desmarca um registo como conferido pelo backoffice.
export default function ValidateToggle({
  entryId,
  validated,
}: {
  entryId: string;
  validated: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    const res = await fetch(`/api/admin/entries/${entryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ validated: !validated }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={
        validated
          ? `${t.entries.validated} — ${t.entries.unvalidateOne}`
          : `${t.entries.pendingValidation} — ${t.entries.validateOne}`
      }
      className={`rounded-lg border px-2 py-1 text-xs font-bold disabled:opacity-50 ${
        validated
          ? "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700"
          : "border-slate-300 text-slate-400 hover:bg-slate-50"
      }`}
    >
      ✓
    </button>
  );
}
