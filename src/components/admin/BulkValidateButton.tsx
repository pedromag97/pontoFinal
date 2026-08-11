"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getDictionary } from "@/lib/i18n";

const t = getDictionary("pt");

// Valida de uma vez todos os registos SEM avisos do filtro atual.
// Os suspeitos ficam de fora, para revisão individual.
export default function BulkValidateButton({
  from,
  to,
  employee,
}: {
  from: string;
  to: string;
  employee: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    if (!confirm(t.entries.validateCleanConfirm)) return;
    setBusy(true);
    setResult(null);
    const res = await fetch("/api/admin/entries/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, employee, mode: "clean" }),
    });
    setBusy(false);
    if (!res.ok) {
      setResult(t.employees.error);
      return;
    }
    const body = await res.json();
    setResult(
      body.count > 0
        ? `${body.count} ${t.entries.validateDone}`
        : t.entries.validateNone
    );
    router.refresh();
  }

  return (
    <span className="flex items-center gap-2">
      <button
        onClick={run}
        disabled={busy}
        className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
      >
        {busy ? "…" : t.entries.validateClean}
      </button>
      {result && <span className="text-xs text-slate-500">{result}</span>}
    </span>
  );
}
