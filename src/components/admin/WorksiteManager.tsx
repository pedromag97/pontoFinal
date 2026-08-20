"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getDictionary } from "@/lib/i18n";
import { useDialogs } from "@/components/ui/Dialogs";
import { mapsUrl } from "@/lib/format";
import type { Worksite } from "@/types";
import PageHeader from "@/components/admin/PageHeader";

const t = getDictionary("pt");

const COORDS_RE = /^\s*(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)\s*$/;

interface WorksiteFields {
  name: string;
  mobile: boolean;
  latitude: number | null;
  longitude: number | null;
  radius_m: number;
}

// Valida nome + "lat, lng" + raio; devolve null se inválido.
function parseFields(
  name: string,
  coords: string,
  radius: string,
  mobile: boolean
): { fields: WorksiteFields | null; error: string | null } {
  // Obras móveis não têm ponto fixo: dispensam coordenadas e raio.
  if (mobile) {
    return {
      fields: {
        name: name.trim(),
        mobile: true,
        latitude: null,
        longitude: null,
        radius_m: 500,
      },
      error: null,
    };
  }
  const match = COORDS_RE.exec(coords);
  if (!match) return { fields: null, error: t.worksites.invalidCoords };
  const latitude = parseFloat(match[1].replace(",", "."));
  const longitude = parseFloat(match[2].replace(",", "."));
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    return { fields: null, error: t.worksites.invalidCoords };
  }
  const radiusM = parseInt(radius, 10);
  if (!Number.isFinite(radiusM) || radiusM < 50 || radiusM > 50000) {
    return { fields: null, error: t.worksites.invalidRadius };
  }
  return {
    fields: {
      name: name.trim(),
      mobile: false,
      latitude,
      longitude,
      radius_m: radiusM,
    },
    error: null,
  };
}

export default function WorksiteManager({
  initialWorksites,
}: {
  initialWorksites: Worksite[];
}) {
  const router = useRouter();
  const dialogs = useDialogs();
  const [name, setName] = useState("");
  const [coords, setCoords] = useState("");
  const [radius, setRadius] = useState("500");
  const [mobile, setMobile] = useState(false);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    id: string;
    name: string;
    coords: string;
    radius: string;
    mobile: boolean;
  } | null>(null);

  async function createWorksite(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const { fields, error } = parseFields(name, coords, radius, mobile);
    if (!fields) {
      setMessage({ ok: false, text: error! });
      return;
    }
    setCreating(true);
    const supabase = createClient();
    const { error: insertError } = await supabase
      .from("worksites")
      .insert(fields);
    setCreating(false);
    if (insertError) {
      setMessage({ ok: false, text: t.worksites.error });
      return;
    }
    setMessage({ ok: true, text: t.worksites.created });
    setName("");
    setCoords("");
    setRadius("500");
    setMobile(false);
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
      return false;
    }
    router.refresh();
    return true;
  }

  function startEdit(site: Worksite) {
    setMessage(null);
    setEditing({
      id: site.id,
      name: site.name,
      coords:
        site.latitude !== null && site.longitude !== null
          ? `${site.latitude}, ${site.longitude}`
          : "",
      radius: String(site.radius_m),
      mobile: site.mobile,
    });
  }

  async function saveEdit() {
    if (!editing) return;
    const { fields, error } = parseFields(
      editing.name,
      editing.coords,
      editing.radius,
      editing.mobile
    );
    if (!fields || !fields.name) {
      setMessage({ ok: false, text: error ?? t.worksites.error });
      return;
    }
    const ok = await update(editing.id, fields);
    if (ok) setEditing(null);
  }

  async function remove(site: Worksite) {
    const ok = await dialogs.confirm({
      title: `${t.worksites.delete} — ${site.name}`,
      message: t.worksites.deleteConfirm,
      confirmLabel: t.worksites.delete,
      danger: true,
    });
    if (!ok) return;
    setBusyId(site.id);
    setMessage(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("worksites")
      .delete()
      .eq("id", site.id);
    setBusyId(null);
    if (error) {
      setMessage({ ok: false, text: t.worksites.error });
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <PageHeader title={t.worksites.title} subtitle={t.worksites.intro} />

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
          {!mobile && (
            <>
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
            </>
          )}
          <label className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={mobile}
              onChange={(e) => setMobile(e.target.checked)}
              className="h-4 w-4 accent-marca-700"
            />
            ⇄ {t.worksites.mobile}
          </label>
          <button
            type="submit"
            disabled={creating}
            className="rounded-lg bg-marca-700 px-5 py-2 text-sm font-semibold text-white hover:bg-marca-800 disabled:opacity-60"
          >
            {creating ? t.worksites.creating : t.worksites.create}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          {mobile ? t.worksites.mobileHint : t.worksites.coordsHint}
        </p>
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
            {initialWorksites.map((site) => {
              const isEditing = editing?.id === site.id;
              const busy = busyId === site.id;
              return (
                <tr
                  key={site.id}
                  className={`border-b border-slate-100 last:border-0 ${!site.active && !isEditing ? "opacity-50" : ""}`}
                >
                  {isEditing ? (
                    <>
                      <td className="px-4 py-2">
                        <input
                          value={editing.name}
                          onChange={(e) =>
                            setEditing({ ...editing, name: e.target.value })
                          }
                          className="w-full min-w-40 rounded-lg border border-marca-400 px-2 py-1.5 text-sm"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <label className="mb-1 flex items-center gap-1.5 text-xs text-slate-500">
                          <input
                            type="checkbox"
                            checked={editing.mobile}
                            onChange={(e) =>
                              setEditing({
                                ...editing,
                                mobile: e.target.checked,
                              })
                            }
                            className="h-3.5 w-3.5 accent-marca-700"
                          />
                          ⇄ {t.worksites.mobileBadge}
                        </label>
                        {!editing.mobile && (
                        <input
                          value={editing.coords}
                          onChange={(e) =>
                            setEditing({ ...editing, coords: e.target.value })
                          }
                          placeholder={t.worksites.coords}
                          className="w-full min-w-44 rounded-lg border border-marca-400 px-2 py-1.5 font-mono text-xs"
                        />
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <input
                          type="number"
                          min={50}
                          max={50000}
                          value={editing.radius}
                          onChange={(e) =>
                            setEditing({ ...editing, radius: e.target.value })
                          }
                          className="w-24 rounded-lg border border-marca-400 px-2 py-1.5 text-right text-sm"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                            site.active
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-slate-200 text-slate-600"
                          }`}
                        >
                          {site.active
                            ? t.worksites.active
                            : t.worksites.inactive}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          <button
                            onClick={saveEdit}
                            disabled={busy}
                            className="rounded-lg bg-marca-700 px-3 py-1 text-xs font-semibold text-white hover:bg-marca-800 disabled:opacity-50"
                          >
                            {t.worksites.save}
                          </button>
                          <ActionButton
                            onClick={() => setEditing(null)}
                            disabled={busy}
                          >
                            {t.worksites.cancel}
                          </ActionButton>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3 font-medium">
                        {site.name}
                        {site.mobile && (
                          <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700">
                            ⇄ {t.worksites.mobileBadge}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {site.latitude !== null && site.longitude !== null ? (
                          <a
                            href={mapsUrl(site.latitude, site.longitude)}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-xs text-marca-700 underline"
                          >
                            🗺 {site.latitude.toFixed(5)},{" "}
                            {site.longitude.toFixed(5)}
                          </a>
                        ) : (
                          <span className="text-xs text-slate-400">
                            {t.worksites.mobileBadge}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {site.mobile ? (
                          <span className="text-slate-300">—</span>
                        ) : (
                          `${site.radius_m} m`
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                            site.active
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-slate-200 text-slate-600"
                          }`}
                        >
                          {site.active
                            ? t.worksites.active
                            : t.worksites.inactive}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          <ActionButton
                            onClick={() => startEdit(site)}
                            disabled={busy}
                          >
                            {t.worksites.edit}
                          </ActionButton>
                          <ActionButton
                            onClick={() =>
                              update(site.id, { active: !site.active })
                            }
                            disabled={busy}
                          >
                            {site.active
                              ? t.worksites.deactivate
                              : t.worksites.activate}
                          </ActionButton>
                          <ActionButton
                            onClick={() => remove(site)}
                            disabled={busy}
                            danger
                          >
                            {t.worksites.delete}
                          </ActionButton>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
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
