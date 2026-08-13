"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getDictionary } from "@/lib/i18n";
import type { Worksite } from "@/types";

const t = getDictionary("pt");

// Obras atribuídas a um funcionário. Registos feitos dentro de uma obra
// atribuída (e sem avisos) são validados automaticamente pelo sistema.
export default function WorksiteAssignment({
  employeeId,
  worksites,
  assigned,
}: {
  employeeId: string;
  worksites: Worksite[];
  assigned: string[];
}) {
  const router = useRouter();
  const ref = useRef<HTMLDetailsElement>(null);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(
    new Set(assigned)
  );
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => setSelecionadas(new Set(assigned)), [assigned]);

  useEffect(() => {
    function onDocumentClick(event: MouseEvent) {
      const details = ref.current;
      if (details?.open && !details.contains(event.target as Node)) {
        details.open = false;
      }
    }
    document.addEventListener("click", onDocumentClick);
    return () => document.removeEventListener("click", onDocumentClick);
  }, []);

  async function toggle(worksiteId: string) {
    const supabase = createClient();
    const tinha = selecionadas.has(worksiteId);
    setBusy(worksiteId);

    const { error } = tinha
      ? await supabase
          .from("employee_worksites")
          .delete()
          .eq("employee_id", employeeId)
          .eq("worksite_id", worksiteId)
      : await supabase
          .from("employee_worksites")
          .insert({ employee_id: employeeId, worksite_id: worksiteId });

    setBusy(null);
    if (error) return;

    setSelecionadas((prev) => {
      const proximo = new Set(prev);
      if (tinha) proximo.delete(worksiteId);
      else proximo.add(worksiteId);
      return proximo;
    });
    router.refresh();
  }

  const nomes = worksites
    .filter((w) => selecionadas.has(w.id))
    .map((w) => w.name);

  return (
    <details ref={ref} className="relative inline-block text-left">
      <summary
        className="cursor-pointer select-none list-none rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
        title={t.employees.worksitesHint}
      >
        🏗{" "}
        {nomes.length === 0
          ? t.employees.worksitesNone
          : nomes.length === 1
            ? nomes[0]
            : `${nomes.length} ${t.employees.worksitesCount}`}
      </summary>
      <div className="absolute right-0 z-30 mt-1 max-h-72 w-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 text-left shadow-lg">
        <p className="px-1 pb-2 text-xs text-slate-500">
          {t.employees.worksitesHint}
        </p>
        {worksites.length === 0 && (
          <p className="px-1 py-2 text-xs text-slate-400">
            {t.employees.worksitesEmpty}
          </p>
        )}
        {worksites.map((w) => (
          <label
            key={w.id}
            className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50"
          >
            <input
              type="checkbox"
              checked={selecionadas.has(w.id)}
              disabled={busy === w.id}
              onChange={() => toggle(w.id)}
              className="h-4 w-4 accent-teal-700"
            />
            <span className={w.active ? "" : "text-slate-400 line-through"}>
              {w.name}
            </span>
          </label>
        ))}
      </div>
    </details>
  );
}
