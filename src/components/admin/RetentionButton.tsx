"use client";

import { useState } from "react";
import { useDialogs } from "@/components/ui/Dialogs";

export default function RetentionButton({
  label,
  confirmText,
  doneSuffix,
}: {
  label: string;
  confirmText: string;
  doneSuffix: string;
}) {
  const [busy, setBusy] = useState(false);
  const dialogs = useDialogs();
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    const ok = await dialogs.confirm({
      title: label,
      message: confirmText,
      confirmLabel: label,
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setResult(null);
    const res = await fetch("/api/admin/retention", { method: "POST" });
    setBusy(false);
    if (!res.ok) {
      setResult("Erro ao aplicar retenção.");
      return;
    }
    const body = await res.json();
    setResult(`${body.purged} ${doneSuffix}`);
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={run}
        disabled={busy}
        className="rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
      >
        {busy ? "…" : label}
      </button>
      {result && <span className="text-sm text-slate-600">{result}</span>}
    </div>
  );
}
