"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getDictionary } from "@/lib/i18n";
import type { Worksite } from "@/types";

const t = getDictionary("pt");

// Obras atribuídas a um funcionário. Registos feitos dentro de uma obra
// atribuída (e sem avisos) são validados automaticamente pelo sistema.
// Abre em janela (e não num popup dentro da linha) porque a tabela tem
// scroll horizontal e cortava a lista.
export default function WorksiteAssignment({
  employeeId,
  employeeName,
  worksites,
  assigned,
}: {
  employeeId: string;
  employeeName: string;
  worksites: Worksite[];
  assigned: string[];
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(
    new Set(assigned)
  );
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => setSelecionadas(new Set(assigned)), [assigned]);

  useEffect(() => {
    if (!aberto) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setAberto(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [aberto]);

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
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        title={nomes.join(" · ") || t.employees.worksitesHint}
        className="max-w-40 truncate rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
      >
        🏗{" "}
        {nomes.length === 0
          ? t.employees.worksitesNone
          : nomes.length === 1
            ? nomes[0]
            : `${nomes.length} ${t.employees.worksitesCount}`}
      </button>

      {aberto && (
        <div
          className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setAberto(false);
          }}
        >
          <div
            className="flex max-h-[80dvh] w-full max-w-md flex-col rounded-2xl bg-white p-5 shadow-xl"
            role="dialog"
            aria-modal="true"
          >
            <h2 className="text-lg font-bold text-slate-900">
              🏗 {t.employees.worksites} — {employeeName}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              {t.employees.worksitesHint}
            </p>

            <div className="-mx-1 mt-4 flex-1 overflow-y-auto px-1">
              {worksites.length === 0 && (
                <p className="py-4 text-sm text-slate-400">
                  {t.employees.worksitesEmpty}
                </p>
              )}
              {worksites.map((w) => (
                <label
                  key={w.id}
                  className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2.5 text-sm hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={selecionadas.has(w.id)}
                    disabled={busy === w.id}
                    onChange={() => toggle(w.id)}
                    className="h-4 w-4 shrink-0 accent-marca-700"
                  />
                  <span className={w.active ? "" : "text-slate-400 line-through"}>
                    {w.name}
                  </span>
                  {w.mobile && (
                    <span className="ml-auto shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700">
                      {t.worksites.mobileBadge}
                    </span>
                  )}
                </label>
              ))}
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setAberto(false)}
                className="rounded-xl bg-marca-700 px-4 py-2 text-sm font-semibold text-white hover:bg-marca-800"
              >
                {t.worksites.close}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
