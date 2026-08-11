"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getDictionary } from "@/lib/i18n";
import { mapsUrl } from "@/lib/format";
import type { Worksite } from "@/types";

const t = getDictionary("pt");

const COORDS_RE = /^\s*(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)\s*$/;

export default function WorksiteManager({
  initialWorksites,
}: {
  initialWorksites: Worksite[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [coords, setCoords] = useState("");
  const [radius, setRadius] = useState("500");
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  );
  const [busyId, setBusyId] = useState<string | null>(null);

  async function createWorksite(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    const match = COORDS_RE.exec(coords);
    if (!match) {
      setMessage({ ok: false, text: t.worksites.invalidCoords });
      return;
    }
    const latitude = parseFloat(match[1].replace(",", "."));
    const longitude = parseFloat(match[2].replace(",", "."));
    const radiusM = parseInt(radius, 10);
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180
    ) {
      setMessage({ ok: false, text: t.worksites.invalidCoords });
      return;
    }
    if (!Number.isFinite(radiusM) || radiusM < 50 || radiusM > 50000) {
      setMessage({ ok: false, text: t.worksites.invalidRadius });
      return;
    }

    setCreating(true);
    const supabase = createClient();
    const { error } = await supabase.from("worksites").insert({
      name: name.trim(),
      latitude,
      longitude,
      radius_m: radiusM,
    });
    setCreating(false);
    if (error) {
      setMessage({ ok: false, text: t.worksites.error });
      return;
    }
    setMessage({ ok: true, text: t.worksites.created });
    setName("");
    setCoords("");
    setRadius("500");
    router.refresh();
  }

  async function update(id: string, values: Partial<Worksite>) {
    setBusyId(id);
    setMessage(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("worksites")
      .update(values)
      .eq("id", id);
    setBusyId(null);
    if (error) {
      setMessage({ ok: false, text: t.worksites.error });
      return;
    }
    router.refresh();
  }

  async function remove(site: Worksite) {
    if (!confirm(t.worksites.deleteConfirm)) return;
    setBusyId(site.id);
    setMessage(null);
    const supabase = createClient();
    const { error } = await supabase.from("worksites").delete().eq("id", site.id);
    setBusyId(null);
    if (error) {
      setMessage({ ok: false, text: t.worksites.error });
      return;
    }
    router.refresh();
  }

  function editRadius(site: Worksite) {
    const input = prompt(t.worksites.editPrompt, String(site.radius_m));
    if (!input) return;
    const value = parseInt(input, 10);
    if (!Number.isFinite(value) || value < 50 || value > 50000) {
      setMessage({ ok: false, text: t.worksites.invalidRadius });
      return;
    }
    update(site.id, { radius_m: value });
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold">{t.worksites.title}</h1>
      <p className="mb-4 max-w-2xl text-sm text-slate-500">
        {t.worksites.intro}
      </p>

      <form
        onSubmit={createWorksite}
        className="mb-6 rounded-2xl bg-white p-5 shadow-sm"
      >
        <h2 className="mb-3 font-semibold">➕ {t.worksites.newTitle}</h2>
        <div className="flex flex-wrap gap-3">
          <input
            required
            placeholder={t.worksites.name}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="min-w-52 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            required
            placeholder={t.worksites.coords}
            value={coords}
            onChange={(e) => setCoords(e.target.value)}
            className="min-w-52 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            required
            type="number"
            min={50}
            max={50000}
            placeholder={t.worksites.radius}
            value={radius}
            onChange={(e) => setRadius(e.target.value)}
            className="w-36 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={creating}
            className="rounded-lg bg-teal-700 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
          >
            {creating ? t.worksites.creating : t.worksites.create}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-400">{t.worksites.coordsHint}</p>
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
              <th className="px-4 py-3">{t.worksites.name}</th>
              <th className="px-4 py-3">GPS</th>
              <th className="px-4 py-3 text-right">{t.worksites.radius}</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {initialWorksites.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  {t.worksites.noData}
                </td>
              </tr>
            )}
            {initialWorksites.map((site) => (
              <tr
                key={site.id}
                className={`border-b border-slate-100 last:border-0 ${!site.active ? "opacity-50" : ""}`}
              >
                <td className="px-4 py-3 font-medium">{site.name}</td>
                <td className="px-4 py-3">
                  <a
                    href={mapsUrl(site.latitude, site.longitude)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-xs text-teal-700 underline"
                  >
                    🗺 {site.latitude.toFixed(5)}, {site.longitude.toFixed(5)}
                  </a>
                </td>
                <td className="px-4 py-3 text-right">{site.radius_m} m</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      site.active
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-slate-200 text-slate-600"
                    }`}
                  >
                    {site.active ? t.worksites.active : t.worksites.inactive}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex flex-wrap justify-end gap-2">
                    <ActionButton
                      onClick={() => editRadius(site)}
                      disabled={busyId === site.id}
                    >
                      {t.worksites.edit}
                    </ActionButton>
                    <ActionButton
                      onClick={() => update(site.id, { active: !site.active })}
                      disabled={busyId === site.id}
                    >
                      {site.active
                        ? t.worksites.deactivate
                        : t.worksites.activate}
                    </ActionButton>
                    <ActionButton
                      onClick={() => remove(site)}
                      disabled={busyId === site.id}
                      danger
                    >
                      {t.worksites.delete}
                    </ActionButton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${
        danger
          ? "border-red-200 text-red-600 hover:bg-red-50"
          : "border-slate-300 text-slate-600 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}
