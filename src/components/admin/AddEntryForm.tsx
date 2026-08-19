"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getDictionary } from "@/lib/i18n";
import { formatTime, todayWorksite } from "@/lib/format";
import type { EntryType, Profile } from "@/types";

const t = getDictionary("pt");

const TYPES: EntryType[] = ["entrada", "saida_almoco", "volta_almoco", "saida"];

const EMOJIS: Record<EntryType, string> = {
  entrada: "🌅",
  saida_almoco: "🍽️",
  volta_almoco: "🔨",
  saida: "🌇",
};

// Horas sugeridas (horário normal) para preencher com um clique.
const SUGESTOES: Record<EntryType, string> = {
  entrada: "08:00",
  saida_almoco: "12:00",
  volta_almoco: "13:00",
  saida: "17:00",
};

// Backoffice preenche o dia de um funcionário que se esqueceu de registar.
// Em vez de um movimento de cada vez, mostra o dia inteiro: o que já existe
// aparece bloqueado e só se escrevem as horas em falta.
export default function AddEntryForm({ employees }: { employees: Profile[] }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState(todayWorksite());
  const [horas, setHoras] = useState<Record<string, string>>({});
  const [existentes, setExistentes] = useState<Record<string, string> | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  );

  // Ao escolher funcionário + dia, mostrar o que já está registado.
  const carregarDia = useCallback(async () => {
    if (!employeeId || !date) {
      setExistentes(null);
      return;
    }
    setExistentes(null);
    const supabase = createClient();
    const { data } = await supabase
      .from("time_entries")
      .select("entry_type, created_at")
      .eq("employee_id", employeeId)
      .eq("entry_date", date)
      .is("rejected_at", null);
    const mapa: Record<string, string> = {};
    for (const linha of data ?? []) {
      mapa[linha.entry_type as string] = formatTime(linha.created_at as string);
    }
    setExistentes(mapa);
  }, [employeeId, date]);

  useEffect(() => {
    if (aberto) carregarDia();
  }, [aberto, carregarDia]);

  function fechar() {
    setAberto(false);
    setHoras({});
    setMessage(null);
  }

  async function submeter(e: React.FormEvent) {
    e.preventDefault();
    const paraCriar = TYPES.filter(
      (tipo) => !existentes?.[tipo] && horas[tipo]
    );
    if (paraCriar.length === 0) {
      setMessage({ ok: false, text: t.entries.addNothing });
      return;
    }

    setBusy(true);
    setMessage(null);
    const falhas: string[] = [];
    for (const tipo of paraCriar) {
      const res = await fetch("/api/admin/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: employeeId,
          date,
          time: horas[tipo],
          entry_type: tipo,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        falhas.push(`${t.types[tipo]}: ${body.error ?? t.employees.error}`);
      }
    }
    setBusy(false);

    if (falhas.length > 0) {
      setMessage({ ok: false, text: falhas.join(" · ") });
    } else {
      setMessage({
        ok: true,
        text: `${paraCriar.length} ${t.entries.addDone}`,
      });
      setHoras({});
    }
    await carregarDia();
    router.refresh();
  }

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        className="mb-4 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
      >
        ✍ {t.entries.addOpen}
      </button>
    );
  }

  const funcionario = employees.find((e) => e.id === employeeId);

  return (
    <form onSubmit={submeter} className="mb-4 rounded-2xl bg-white p-5 shadow-sm">
      <div className="mb-1 flex items-start justify-between gap-4">
        <h2 className="font-semibold">✍ {t.entries.addTitle}</h2>
        <button
          type="button"
          onClick={fechar}
          className="rounded-lg px-2 text-lg leading-none text-slate-400 hover:text-slate-700"
          aria-label={t.worksites.cancel}
        >
          ×
        </button>
      </div>
      <p className="mb-4 max-w-2xl text-xs text-slate-500">
        {t.entries.addSubtitle}
      </p>

      <div className="mb-4 flex flex-wrap gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">
            {t.entries.employee}
          </label>
          <select
            required
            value={employeeId}
            onChange={(e) => {
              setEmployeeId(e.target.value);
              setHoras({});
              setMessage(null);
            }}
            className="min-w-52 rounded-xl border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">—</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.full_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">
            {t.entries.date}
          </label>
          <input
            required
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setHoras({});
              setMessage(null);
            }}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      {!employeeId ? (
        <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
          {t.entries.employee} →
        </p>
      ) : existentes === null ? (
        <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
          {t.entries.addLoading}
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {TYPES.map((tipo) => {
            const jaExiste = existentes[tipo];
            return (
              <div
                key={tipo}
                className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
                  jaExiste
                    ? "border-emerald-200 bg-emerald-50/60"
                    : "border-slate-200"
                }`}
              >
                <span className="text-lg">{EMOJIS[tipo]}</span>
                <span className="flex-1 text-sm font-medium text-slate-700">
                  {t.types[tipo]}
                </span>
                {jaExiste ? (
                  <span className="text-sm font-semibold text-emerald-700">
                    {jaExiste}
                    <span className="ml-1 text-xs font-normal text-emerald-600">
                      ({t.entries.addExisting})
                    </span>
                  </span>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setHoras((h) => ({ ...h, [tipo]: SUGESTOES[tipo] }))
                      }
                      className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
                      title={SUGESTOES[tipo]}
                    >
                      {SUGESTOES[tipo]}
                    </button>
                    <input
                      type="time"
                      value={horas[tipo] ?? ""}
                      onChange={(e) =>
                        setHoras((h) => ({ ...h, [tipo]: e.target.value }))
                      }
                      className="w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-marca-600 focus:ring-2 focus:ring-marca-600/20"
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {message && (
        <p
          className={`mt-3 rounded-xl px-4 py-2.5 text-sm ${
            message.ok
              ? "bg-emerald-50 text-emerald-700"
              : "bg-red-50 text-red-700"
          }`}
        >
          {message.text}
        </p>
      )}

      <div className="mt-4 flex items-center gap-2">
        <button
          type="submit"
          disabled={busy || !employeeId}
          className="rounded-xl bg-marca-700 px-5 py-2 text-sm font-semibold text-white hover:bg-marca-800 disabled:opacity-50"
        >
          {busy ? t.entries.adding : t.entries.addButton}
        </button>
        <button
          type="button"
          onClick={fechar}
          className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
        >
          {t.worksites.cancel}
        </button>
        {funcionario && (
          <span className="ml-auto text-xs text-slate-400">
            {funcionario.full_name} · {date}
          </span>
        )}
      </div>
    </form>
  );
}
