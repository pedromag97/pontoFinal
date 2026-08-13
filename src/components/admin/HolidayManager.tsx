"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getDictionary } from "@/lib/i18n";
import { useDialogs } from "@/components/ui/Dialogs";
import { formatDateShort } from "@/lib/format";
import type { Holiday } from "@/types";

const t = getDictionary("pt");

export default function HolidayManager({
  initialHolidays,
}: {
  initialHolidays: Holiday[];
}) {
  const router = useRouter();
  const dialogs = useDialogs();
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  );

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("holidays")
      .insert({ holiday_date: date, name: name.trim() });
    setBusy(false);
    if (error) {
      setMessage({
        ok: false,
        text: error.code === "23505" ? t.holidays.exists : t.holidays.error,
      });
      return;
    }
    setMessage({ ok: true, text: t.holidays.added });
    setDate("");
    setName("");
    router.refresh();
  }

  async function remove(holiday: Holiday) {
    const ok = await dialogs.confirm({
      title: t.holidays.delete,
      message: `${t.holidays.deleteConfirm} (${holiday.name})`,
      confirmLabel: t.holidays.delete,
      danger: true,
    });
    if (!ok) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("holidays")
      .delete()
      .eq("holiday_date", holiday.holiday_date);
    if (error) {
      setMessage({ ok: false, text: t.holidays.error });
      return;
    }
    router.refresh();
  }

  // agrupar por ano para leitura fácil
  const byYear = new Map<string, Holiday[]>();
  for (const holiday of initialHolidays) {
    const year = holiday.holiday_date.slice(0, 4);
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year)!.push(holiday);
  }

  const weekdayOf = (iso: string) =>
    new Intl.DateTimeFormat("pt-PT", {
      weekday: "short",
      timeZone: "UTC",
    }).format(new Date(`${iso}T12:00:00Z`));

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold">📅 {t.holidays.title}</h1>
      <p className="mb-4 max-w-2xl text-sm text-slate-500">
        {t.holidays.intro}
      </p>

      <form onSubmit={add} className="mb-6 rounded-2xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">
              {t.holidays.date}
            </label>
            <input
              required
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <input
            required
            placeholder={t.holidays.name}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="min-w-64 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-teal-700 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
          >
            {busy ? t.holidays.adding : t.holidays.add}
          </button>
        </div>
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

      {initialHolidays.length === 0 && (
        <p className="rounded-2xl bg-white py-8 text-center text-slate-400 shadow-sm">
          {t.holidays.noData}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {[...byYear.entries()].map(([year, holidays]) => (
          <div key={year} className="rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="mb-2 font-bold">{year}</h2>
            <ul className="divide-y divide-slate-100">
              {holidays.map((holiday) => (
                <li
                  key={holiday.holiday_date}
                  className="flex items-center justify-between py-1.5 text-sm"
                >
                  <span>
                    <span className="mr-2 inline-block w-20 font-mono text-xs text-slate-500">
                      {weekdayOf(holiday.holiday_date)}{" "}
                      {formatDateShort(holiday.holiday_date)}
                    </span>
                    {holiday.name}
                  </span>
                  <button
                    onClick={() => remove(holiday)}
                    title={t.holidays.delete}
                    className="rounded-lg border border-red-200 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50"
                  >
                    🗑
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
