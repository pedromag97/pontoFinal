import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireAdmin } from "@/lib/auth";
import {
  clockDriftMinutes,
  formatTimeSeconds,
  mapsUrl,
  monthWorksite,
  todayWorksite,
  workedHours,
} from "@/lib/format";
import type { EntryType, TimeEntryWithName } from "@/types";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const TYPE_LABEL: Record<EntryType, string> = {
  entrada: "Entrada",
  saida_almoco: "Saída almoço",
  volta_almoco: "Volta almoço",
  saida: "Saída",
};

interface ExportRow {
  name: string;
  date: string;
  type: string;
  serverTime: string;
  clientTime: string;
  driftMin: number | "";
  latitude: number;
  longitude: number;
  accuracy: number | "";
  suspicious: string;
  photoUrl: string;
  mapUrl: string;
}

interface SummaryRow {
  name: string;
  date: string;
  entrada: string;
  saidaAlmoco: string;
  voltaAlmoco: string;
  saida: string;
  hours: number | "";
}

// Exportação CSV / XLSX dos registos filtrados, pronta para salários.
export async function GET(request: Request) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const from = DATE_RE.test(url.searchParams.get("from") ?? "")
    ? url.searchParams.get("from")!
    : `${monthWorksite()}-01`;
  const to = DATE_RE.test(url.searchParams.get("to") ?? "")
    ? url.searchParams.get("to")!
    : todayWorksite();
  const employee = url.searchParams.get("employee") ?? "";
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";

  const { supabase } = session;
  let query = supabase
    .from("time_entries")
    .select("*, profiles(full_name)")
    .gte("entry_date", from)
    .lte("entry_date", to)
    .order("entry_date")
    .order("created_at")
    .limit(10000);
  if (employee) query = query.eq("employee_id", employee);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const entries = (data ?? []) as TimeEntryWithName[];

  // Signed URLs de 7 dias para as fotos (o Excel vai ter links clicáveis).
  const paths = entries
    .map((e) => e.photo_path)
    .filter((p): p is string => !!p);
  const signedByPath = new Map<string, string>();
  for (let i = 0; i < paths.length; i += 100) {
    const { data: signed } = await supabase.storage
      .from("selfies")
      .createSignedUrls(paths.slice(i, i + 100), 7 * 24 * 3600);
    signed?.forEach((s) => {
      if (s.signedUrl && s.path) signedByPath.set(s.path, s.signedUrl);
    });
  }

  const rows: ExportRow[] = entries.map((entry) => {
    const drift = clockDriftMinutes(entry.created_at, entry.client_timestamp);
    const flags = entry.flags ?? {};
    const suspiciousParts: string[] = [];
    if (flags.low_gps_accuracy) suspiciousParts.push("GPS impreciso");
    if (flags.clock_drift) suspiciousParts.push("Relógio desviado");
    return {
      name: entry.profiles?.full_name ?? "?",
      date: entry.entry_date,
      type: TYPE_LABEL[entry.entry_type],
      serverTime: formatTimeSeconds(entry.created_at),
      clientTime: entry.client_timestamp
        ? formatTimeSeconds(entry.client_timestamp)
        : "",
      driftMin: drift ?? "",
      latitude: entry.latitude,
      longitude: entry.longitude,
      accuracy: entry.gps_accuracy !== null ? Math.round(entry.gps_accuracy) : "",
      suspicious: suspiciousParts.join(" + "),
      photoUrl: entry.photo_path
        ? (signedByPath.get(entry.photo_path) ?? "")
        : "",
      mapUrl: mapsUrl(entry.latitude, entry.longitude),
    };
  });

  // Resumo por funcionário/dia com horas trabalhadas (desconta o almoço
  // quando a saída/volta do almoço estão registadas).
  const byKey = new Map<
    string,
    { name: string; date: string; dayEntries: TimeEntryWithName[] }
  >();
  for (const entry of entries) {
    const key = `${entry.employee_id}|${entry.entry_date}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        name: entry.profiles?.full_name ?? "?",
        date: entry.entry_date,
        dayEntries: [],
      });
    }
    byKey.get(key)!.dayEntries.push(entry);
  }
  const timeOf = (day: TimeEntryWithName[], type: EntryType) => {
    const found = day.find((e) => e.entry_type === type);
    return found ? formatTimeSeconds(found.created_at) : "";
  };
  const summary: SummaryRow[] = [...byKey.values()]
    .sort((a, b) => a.name.localeCompare(b.name) || a.date.localeCompare(b.date))
    .map((day) => ({
      name: day.name,
      date: day.date,
      entrada: timeOf(day.dayEntries, "entrada"),
      saidaAlmoco: timeOf(day.dayEntries, "saida_almoco"),
      voltaAlmoco: timeOf(day.dayEntries, "volta_almoco"),
      saida: timeOf(day.dayEntries, "saida"),
      hours: workedHours(day.dayEntries) ?? "",
    }));

  const filename = `registos_${from}_${to}`;

  if (format === "csv") {
    const header = [
      "Funcionario",
      "Data",
      "Tipo",
      "Hora servidor (Paris)",
      "Hora telemovel",
      "Desvio (min)",
      "Latitude",
      "Longitude",
      "Precisao (m)",
      "Suspeito",
      "Foto (link 7 dias)",
      "Mapa",
    ];
    const lines = [header.join(";")];
    for (const row of rows) {
      lines.push(
        [
          csvEscape(row.name),
          row.date,
          row.type,
          row.serverTime,
          row.clientTime,
          String(row.driftMin),
          String(row.latitude),
          String(row.longitude),
          String(row.accuracy),
          csvEscape(row.suspicious),
          csvEscape(row.photoUrl),
          csvEscape(row.mapUrl),
        ].join(";")
      );
    }
    // BOM para o Excel abrir com acentos corretos.
    const csv = "﻿" + lines.join("\r\n");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}.csv"`,
      },
    });
  }

  // XLSX com duas folhas: registos + resumo diário (horas).
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Registos");
  sheet.columns = [
    { header: "Funcionário", key: "name", width: 24 },
    { header: "Data", key: "date", width: 12 },
    { header: "Tipo", key: "type", width: 10 },
    { header: "Hora servidor (Paris)", key: "serverTime", width: 18 },
    { header: "Hora telemóvel", key: "clientTime", width: 15 },
    { header: "Desvio (min)", key: "driftMin", width: 12 },
    { header: "Latitude", key: "latitude", width: 12 },
    { header: "Longitude", key: "longitude", width: 12 },
    { header: "Precisão (m)", key: "accuracy", width: 12 },
    { header: "Suspeito", key: "suspicious", width: 24 },
    { header: "Foto (link 7 dias)", key: "photoUrl", width: 20 },
    { header: "Mapa", key: "mapUrl", width: 20 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) {
    const added = sheet.addRow(row);
    if (row.photoUrl) {
      added.getCell("photoUrl").value = {
        text: "Ver foto",
        hyperlink: row.photoUrl,
      };
    }
    added.getCell("mapUrl").value = { text: "Ver mapa", hyperlink: row.mapUrl };
    if (row.suspicious) {
      added.getCell("suspicious").font = { color: { argb: "FFB45309" }, bold: true };
    }
  }

  const summarySheet = workbook.addWorksheet("Resumo diário");
  summarySheet.columns = [
    { header: "Funcionário", key: "name", width: 24 },
    { header: "Data", key: "date", width: 12 },
    { header: "Entrada", key: "entrada", width: 12 },
    { header: "Saída almoço", key: "saidaAlmoco", width: 13 },
    { header: "Volta almoço", key: "voltaAlmoco", width: 13 },
    { header: "Saída", key: "saida", width: 12 },
    { header: "Horas", key: "hours", width: 10 },
  ];
  summarySheet.getRow(1).font = { bold: true };
  summary.forEach((row) => summarySheet.addRow(row));

  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
    },
  });
}

function csvEscape(value: string): string {
  if (value.includes(";") || value.includes('"') || value.includes("\n")) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}
