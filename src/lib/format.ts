// Todas as horas são registadas e apresentadas em hora de Portugal
// (Lisboa/Porto) — o fuso do processamento salarial. Os funcionários em
// França veem as horas em hora portuguesa (−1h face ao relógio local deles).
export const WORKSITE_TZ = "Europe/Lisbon";

export function todayWorksite(): string {
  // 'en-CA' devolve YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone: WORKSITE_TZ }).format(
    new Date()
  );
}

export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: WORKSITE_TZ,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatTimeSeconds(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: WORKSITE_TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(iso));
}

export function formatDate(isoDate: string, locale: string): string {
  // isoDate = YYYY-MM-DD; meio-dia UTC evita saltos de dia por fuso horário
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${isoDate}T12:00:00Z`));
}

export function formatDateShort(isoDate: string): string {
  return new Intl.DateTimeFormat("pt-PT", { timeZone: "UTC" }).format(
    new Date(`${isoDate}T12:00:00Z`)
  );
}

export function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

// Desvio em minutos entre a hora do servidor e a do cliente.
export function clockDriftMinutes(
  createdAt: string,
  clientTimestamp: string | null
): number | null {
  if (!clientTimestamp) return null;
  const drift =
    (new Date(createdAt).getTime() - new Date(clientTimestamp).getTime()) /
    60000;
  return Math.round(drift * 10) / 10;
}

// Horas trabalhadas entre dois instantes (decimal, 2 casas).
export function hoursBetween(entradaIso: string, saidaIso: string): number {
  const h =
    (new Date(saidaIso).getTime() - new Date(entradaIso).getTime()) / 3600000;
  return Math.round(h * 100) / 100;
}

// Dia da semana no fuso da obra: 0 = domingo … 6 = sábado.
export function weekdayWorksite(): number {
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone: WORKSITE_TZ,
    weekday: "short",
  }).format(new Date());
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(short);
}

// Horas trabalhadas num dia. Com pausa de almoço registada, desconta-a:
// (saída almoço − entrada) + (saída − volta almoço); senão, saída − entrada.
export function workedHours(
  day: { entry_type: string; created_at: string }[]
): number | null {
  const get = (t: string) => day.find((e) => e.entry_type === t);
  const entrada = get("entrada");
  const saida = get("saida");
  if (!entrada || !saida) return null;
  const saidaAlmoco = get("saida_almoco");
  const voltaAlmoco = get("volta_almoco");
  const h =
    saidaAlmoco && voltaAlmoco
      ? hoursBetween(entrada.created_at, saidaAlmoco.created_at) +
        hoursBetween(voltaAlmoco.created_at, saida.created_at)
      : hoursBetween(entrada.created_at, saida.created_at);
  return Math.round(h * 100) / 100;
}

// Converte "YYYY-MM-DD" + "HH:MM" (hora de Lisboa) em ISO UTC.
export function lisbonToUtcIso(dateStr: string, timeStr: string): string {
  const guess = new Date(`${dateStr}T${timeStr}:00Z`);
  const local = new Date(
    guess.toLocaleString("en-US", { timeZone: WORKSITE_TZ })
  );
  const utc = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
  const offsetMs = local.getTime() - utc.getTime();
  return new Date(guess.getTime() - offsetMs).toISOString();
}

export function monthWorksite(): string {
  return todayWorksite().slice(0, 7); // YYYY-MM
}

export function monthBounds(month: string): { from: string; to: string } {
  // month = YYYY-MM → primeiro e último dia do mês
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    from: `${month}-01`,
    to: `${month}-${String(last).padStart(2, "0")}`,
  };
}
