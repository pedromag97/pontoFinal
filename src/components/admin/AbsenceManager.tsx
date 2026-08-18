"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getDictionary } from "@/lib/i18n";
import { useDialogs } from "@/components/ui/Dialogs";
import { formatDateShort, todayWorksite } from "@/lib/format";
import type { AbsenceKind, AbsenceWithName, Profile } from "@/types";

const t = getDictionary("pt");

const KINDS: AbsenceKind[] = ["ferias", "baixa", "falta"];

const KIND_STYLE: Record<AbsenceKind, string> = {
  ferias: "bg-sky-100 text-sky-800",
  baixa: "bg-rose-100 text-rose-800",
  falta: "bg-amber-100 text-amber-800",
};

// Dias de calendário entre duas datas, inclusive.
function contarDias(inicio: string, fim: string): number {
  const ms =
    new Date(`${fim}T12:00:00Z`).getTime() -
    new Date(`${inicio}T12:00:00Z`).getTime();
  return Math.round(ms / 86400000) + 1;
}

export default function AbsenceManager({
  employees,
  absences,
}: {
  employees: Profile[];
  absences: AbsenceWithName[];
}) {
  const router = useRouter();
  const dialogs = useDialogs();
  const hoje = todayWorksite();

  const [employeeId, setEmployeeId] = useState("");
  const [kind, setKind] = useState<AbsenceKind>("ferias");
  const [inicio, setInicio] = useState(hoje);
  const [fim, setFim] = useState(hoje);
  const [nota, setNota] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  );

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (fim < inicio) {
      setMessage({ ok: false, text: t.absences.invalidRange });
      return;
    }

    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("absences").insert({
      employee_id: employeeId,
      kind,
      start_date: inicio,
      end_date: fim,
      note: nota.trim() || null,
    });
    setBusy(false);

    if (error) {
      // 23P01 = exclusion constraint: já há ausência nesse período
      setMessage({
        ok: false,
        text: error.code === "23P01" ? t.absences.overlap : t.absences.error,
      });
      return;
    }
    setMessage({ ok: true, text: t.absences.added });
    setNota("");
    router.refresh();
  }

  async function apagar(a: AbsenceWithName) {
    const ok = await dialogs.confirm({
      title: t.absences.delete,
      message: `${a.profiles?.full_name ?? ""} · ${formatDateShort(a.start_date)} – ${formatDateShort(a.end_date)}\n${t.absences.deleteConfirm}`,
      confirmLabel: t.absences.delete,
      danger: true,
    });
    if (!ok) return;
    const supabase = createClient();
    const { error } = await supabase.from("absences").delete().eq("id", a.id);
    if (error) {
      setMessage({ ok: false, text: t.absences.error });
      return;
    }
    router.refresh();
  }

  // A decorrer/futuras primeiro; passadas em baixo, mais discretas.
  const atuais = absences.filter((a) => a.end_date >= hoje);
  const passadas = absences.filter((a) => a.end_date < hoje);

  function linha(a: AbsenceWithName, passada: boolean) {
    const dias = contarDias(a.start_date, a.end_date);
    const aDecorrer = a.start_date <= hoje && a.end_date >= hoje;
    return (
      <tr
        key={a.id}
        className={`border-b border-slate-100 last:border-0 ${passada ? "opacity-50" : ""}`}
      >
        <td className="px-4 py-3 font-medium">
          {a.profiles?.full_name ?? "—"}
          {aDecorrer && (
            <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
              hoje
            </span>
          )}
        </td>
        <td className="px-4 py-3">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${KIND_STYLE[a.kind]}`}
          >
            {t.absences.kinds[a.kind]}
          </span>
        </td>
        <td className="px-4 py-3 whitespace-nowrap">
          {a.start_date === a.end_date
            ? formatDateShort(a.start_date)
            : `${formatDateShort(a.start_date)} – ${formatDateShort(a.end_date)}`}
          <span className="ml-2 text-xs text-slate-400">
            {dias} {dias === 1 ? t.absences.day : t.absences.days}
          </span>
        </td>
        <td className="px-4 py-3 text-sm text-slate-500">{a.note ?? ""}</td>
        <td className="px-4 py-3 text-right">
          <button
            onClick={() => apagar(a)}
            className="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
          >
            {t.absences.delete}
          </button>
        </td>
      </tr>
    );
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold">{t.absences.title}</h1>
      <p className="mb-4 max-w-2xl text-sm text-slate-500">{t.absences.intro}</p>

      <form onSubmit={criar} className="mb-6 rounded-2xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">
              {t.absences.employee}
            </label>
            <select
              required
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="min-w-48 rounded-xl border border-slate-300 px-3 py-2 text-sm"
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
              {t.absences.kind}
            </label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as AbsenceKind)}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t.absences.kinds[k]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">
              {t.absences.from}
            </label>
            <input
              required
              type="date"
              value={inicio}
              onChange={(e) => {
                setInicio(e.target.value);
                // um dia só, por defeito: o fim acompanha o início
                if (fim < e.target.value) setFim(e.target.value);
              }}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">
              {t.absences.to}
            </label>
            <input
              required
              type="date"
              value={fim}
              min={inicio}
              onChange={(e) => setFim(e.target.value)}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-slate-500">
              {t.absences.note}
            </label>
            <input
              type="text"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              className="w-full min-w-40 rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-teal-700 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
          >
            {busy ? t.absences.adding : t.absences.add}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-400">{t.absences.toHint}</p>
      </form>

      {message && (
        <p
          className={`mb-4 rounded-xl px-4 py-3 text-sm ${
            message.ok
              ? "bg-emerald-50 text-emerald-700"
              : "bg-red-50 text-red-700"
          }`}
        >
          {message.text}
        </p>
      )}

      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3">{t.absences.employee}</th>
              <th className="px-4 py-3">{t.absences.kind}</th>
              <th className="px-4 py-3">{t.absences.period}</th>
              <th className="px-4 py-3">{t.absences.note}</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {absences.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  {t.absences.noData}
                </td>
              </tr>
            )}
            {atuais.map((a) => linha(a, false))}
            {passadas.length > 0 && (
              <tr className="border-b border-slate-200 bg-slate-100/80">
                <td
                  colSpan={5}
                  className="px-4 py-1.5 text-xs font-semibold text-slate-500"
                >
                  {t.absences.past}
                </td>
              </tr>
            )}
            {passadas.map((a) => linha(a, true))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
