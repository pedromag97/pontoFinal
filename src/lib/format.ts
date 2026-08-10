// Todas as horas são apresentadas no fuso da obra (França), tanto para o
// funcionário como para a gestão em Portugal — evita ambiguidade nos salários.
export const WORKSITE_TZ = "Europe/Paris";

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

// Horas trabalhadas entre entrada e saída (decimal, 2 casas).
export function hoursBetween(entradaIso: string, saidaIso: string): number {
  const h =
    (new Date(saidaIso).getTime() - new Date(entradaIso).getTime()) / 3600000;
  return Math.round(h * 100) / 100;
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
