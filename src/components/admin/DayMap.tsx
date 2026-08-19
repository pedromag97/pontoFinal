"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import { getDictionary } from "@/lib/i18n";
import { formatTime } from "@/lib/format";
import type { EntryType, TimeEntryWithName, Worksite } from "@/types";

const t = getDictionary("pt");

const TYPE_COLOR: Record<EntryType, string> = {
  entrada: "#0284c7", // sky-600
  saida_almoco: "#d97706", // amber-600
  volta_almoco: "#65a30d", // lime-600
  saida: "#7c3aed", // violet-600
};

export default function DayMap({
  entries,
  worksites,
  photoUrls,
}: {
  entries: TimeEntryWithName[];
  worksites: Worksite[];
  photoUrls: Record<string, string>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let map: import("leaflet").Map | null = null;
    let cancelled = false;

    (async () => {
      // Leaflet só existe no browser — importado dinamicamente.
      const mod = await import("leaflet");
      const L = ((mod as { default?: typeof import("leaflet") }).default ??
        mod) as typeof import("leaflet");
      if (cancelled || !containerRef.current) return;

      map = L.map(containerRef.current, { scrollWheelZoom: true });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);

      const bounds = L.latLngBounds([]);

      // Obras: círculo com o raio real.
      for (const site of worksites) {
        // Obras móveis não têm ponto fixo — não se desenham.
        if (site.latitude === null || site.longitude === null) continue;
        const center: [number, number] = [site.latitude, site.longitude];
        L.circle(center, {
          radius: site.radius_m,
          color: "#0f766e",
          weight: 2,
          fillColor: "#0f766e",
          fillOpacity: 0.08,
        })
          .addTo(map)
          .bindPopup(
            `<b>🏗 ${escapeHtml(site.name)}</b><br/>raio ${site.radius_m} m`
          );
        bounds.extend(center);
      }

      // Registos: círculos coloridos por tipo; contorno vermelho = suspeito.
      // Registos manuais não têm GPS — não aparecem no mapa.
      for (const entry of entries) {
        if (entry.latitude === null || entry.longitude === null) continue;
        const flags = entry.flags ?? {};
        const suspicious =
          !!flags.low_gps_accuracy ||
          !!flags.clock_drift ||
          !!flags.out_of_area;
        const position: [number, number] = [entry.latitude, entry.longitude];
        const photoUrl = entry.photo_path
          ? photoUrls[entry.photo_path]
          : undefined;

        const popup = [
          `<b>${escapeHtml(entry.profiles?.full_name ?? "?")}</b>`,
          `${t.types[entry.entry_type]} — ${formatTime(entry.created_at)}`,
          entry.worksites?.name ? `🏗 ${escapeHtml(entry.worksites.name)}` : "",
          suspicious ? "⚠️ suspeito" : "",
          photoUrl
            ? `<a href="${photoUrl}" target="_blank" rel="noreferrer">📷 ${t.map.openPhoto}</a>`
            : "",
        ]
          .filter(Boolean)
          .join("<br/>");

        L.circleMarker(position, {
          radius: 9,
          color: suspicious ? "#dc2626" : "#ffffff",
          weight: 2.5,
          fillColor: TYPE_COLOR[entry.entry_type],
          fillOpacity: 0.95,
        })
          .addTo(map)
          .bindPopup(popup);
        bounds.extend(position);
      }

      if (bounds.isValid()) {
        map.fitBounds(bounds.pad(0.25), { maxZoom: 16 });
      } else {
        map.setView([42.5, -4], 5); // Portugal + França
      }
    })();

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [entries, worksites, photoUrls]);

  return (
    <div>
      <div
        ref={containerRef}
        className="h-[65dvh] w-full rounded-2xl shadow-sm"
      />
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        {(Object.keys(TYPE_COLOR) as EntryType[]).map((type) => (
          <span key={type} className="flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ backgroundColor: TYPE_COLOR[type] }}
            />
            {t.types[type]}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full border-2 border-marca-700 bg-marca-700/10" />
          {t.map.worksiteLegend}
        </span>
        <span>({t.map.flaggedLegend})</span>
        {entries.length === 0 && worksites.length === 0 && (
          <span className="font-medium text-amber-600">{t.map.noData}</span>
        )}
      </div>
    </div>
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
