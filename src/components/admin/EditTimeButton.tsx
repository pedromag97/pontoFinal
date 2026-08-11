"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getDictionary } from "@/lib/i18n";

const t = getDictionary("pt");

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Corrigir a hora de um registo existente (fica marcado "Editado").
export default function EditTimeButton({
  entryId,
  currentTime,
}: {
  entryId: string;
  currentTime: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function edit() {
    const input = prompt(t.entries.editTimePrompt, currentTime);
    if (!input) return;
    if (!TIME_RE.test(input.trim())) {
      alert(t.entries.invalidTime);
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/admin/entries/${entryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ time: input.trim() }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  return (
    <button
      onClick={edit}
      disabled={busy}
      title={t.entries.editTime}
      className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 disabled:opacity-50"
    >
      ✏️
    </button>
  );
}
