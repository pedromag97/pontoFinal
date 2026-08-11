"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getDictionary } from "@/lib/i18n";
import { todayWorksite } from "@/lib/format";
import type { EntryType, Profile } from "@/types";

const t = getDictionary("pt");

const TYPES: EntryType[] = ["entrada", "saida_almoco", "volta_almoco", "saida"];

// Backoffice adiciona um registo que o funcionário se esqueceu de fazer.
export default function AddEntryForm({ employees }: { employees: Profile[] }) {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState(todayWorksite());
  const [entryType, setEntryType] = useState<EntryType>("entrada");
  const [time, setTime] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/admin/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employee_id: employeeId,
        date,
        time,
        entry_type: entryType,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setMessage({ ok: false, text: body.error ?? t.employees.error });
      return;
    }
    setMessage({ ok: true, text: t.entries.added });
    setTime("");
    router.refresh();
  }

  return (
    <form
      onSubmit={submit}
      className="mb-4 rounded-2xl bg-white p-4 shadow-sm"
    >
      <h2 className="mb-3 text-sm font-semibold">✍ {t.entries.addTitle}</h2>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">
            {t.entries.employee}
          </label>
          <select
            required
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
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
            onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">
            {t.entries.type}
          </label>
          <select
            value={entryType}
            onChange={(e) => setEntryType(e.target.value as EntryType)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {TYPES.map((type) => (
              <option key={type} value={type}>
                {t.types[type]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">
            {t.entries.time}
          </label>
          <input
            required
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
        >
          {busy ? t.entries.adding : t.entries.addButton}
        </button>
        {message && (
          <span
            className={`text-sm ${message.ok ? "text-emerald-700" : "text-red-600"}`}
          >
            {message.text}
          </span>
        )}
      </div>
    </form>
  );
}
