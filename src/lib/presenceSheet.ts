import "server-only";
import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from "pdf-lib";
import { WORKSITE_TZ } from "@/lib/format";
import type { TimeEntry } from "@/types";

// Folha de presença mensal em PDF (layout tipo "Registre de Présence"):
// uma linha por dia do mês, blocos Manhã (entrada → saída almoço) e
// Tarde (volta almoço → saída), coluna Ass. em branco para assinar em papel.
// Horas arredondadas aos 15 minutos. Sábados só saem se include_saturdays.

interface SheetInput {
  employeeName: string;
  month: string; // YYYY-MM
  worksiteName: string | null;
  entries: TimeEntry[];
  includeSaturdays: boolean;
}

const WEEKDAY_LABELS = ["Dom", "2ª", "3ª", "4ª", "5ª", "6ª", "Sáb"];

const MONTH_NAMES = [
  "JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO",
  "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO",
];

// Hora local (Lisboa) arredondada aos 15 min, em minutos desde a meia-noite.
function roundedMinutes(iso: string): number {
  const text = new Intl.DateTimeFormat("en-GB", {
    timeZone: WORKSITE_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
  const [h, m] = text.split(":").map(Number);
  return (Math.round((h * 60 + m) / 15) * 15) % 1440;
}

function minutesToText(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Domingo de Páscoa (calendário gregoriano).
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

// Feriados de França (onde as obras estão), chave "MM-DD".
function frenchHolidays(year: number): Map<string, string> {
  const map = new Map<string, string>([
    ["01-01", "Ano Novo"],
    ["05-01", "Dia do Trabalhador"],
    ["05-08", "Vitória de 1945"],
    ["07-14", "Festa Nacional (França)"],
    ["08-15", "Assunção"],
    ["11-01", "Todos os Santos"],
    ["11-11", "Armistício"],
    ["12-25", "Natal"],
  ]);
  const easter = easterSunday(year);
  const add = (offsetDays: number, name: string) => {
    const date = new Date(easter.getTime() + offsetDays * 86400000);
    const key = `${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
    map.set(key, name);
  };
  add(1, "Segunda de Páscoa");
  add(39, "Ascensão");
  add(50, "Segunda de Pentecostes");
  return map;
}

export async function buildPresenceSheet(
  input: SheetInput
): Promise<Uint8Array> {
  const [year, monthNumber] = input.month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const holidays = frenchHolidays(year);

  const byDay = new Map<number, TimeEntry[]>();
  for (const entry of input.entries) {
    const day = Number(entry.entry_date.slice(8, 10));
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(entry);
  }

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]); // A4 retrato
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const black = rgb(0.1, 0.1, 0.1);
  const gray = rgb(0.55, 0.55, 0.55);
  const weekendFill = rgb(0.93, 0.93, 0.93);
  const line = rgb(0.6, 0.6, 0.6);

  const drawCentered = (
    p: PDFPage,
    text: string,
    x: number,
    width: number,
    y: number,
    size: number,
    f: PDFFont,
    color = black
  ) => {
    const w = f.widthOfTextAtSize(text, size);
    p.drawText(text, { x: x + (width - w) / 2, y, size, font: f, color });
  };

  // ---------- cabeçalho ----------
  drawCentered(page, "REGISTO DE PRESENÇA", 0, 595.28, 800, 16, bold);
  drawCentered(
    page,
    `${MONTH_NAMES[monthNumber - 1]} ${year}`,
    0,
    595.28,
    780,
    12,
    bold
  );

  page.drawText(`Funcionário: ${input.employeeName}`, {
    x: 40, y: 752, size: 10, font: bold, color: black,
  });
  page.drawText(`Mês: ${String(monthNumber).padStart(2, "0")}/${year}`, {
    x: 430, y: 752, size: 10, font, color: black,
  });
  page.drawText(
    `Local de trabalho: ${input.worksiteName ?? "________________________"}`,
    { x: 40, y: 736, size: 10, font, color: black }
  );

  // ---------- tabela ----------
  const x0 = 40;
  const widths = [30, 26, 58, 58, 40, 58, 58, 40, 147];
  const xs: number[] = [x0];
  for (const w of widths) xs.push(xs[xs.length - 1] + w);
  const tableRight = xs[xs.length - 1];

  const groupY = 712; // linha "MANHÃ / TARDE"
  const headY = 696; // linha Entrada/Saída/Ass.
  const rowH = 15.6;
  const bodyTop = headY - 4;

  drawCentered(page, "1º — MANHÃ", xs[2], widths[2] + widths[3] + widths[4], groupY + 3, 9, bold);
  drawCentered(page, "2º — TARDE", xs[5], widths[5] + widths[6] + widths[7], groupY + 3, 9, bold);

  const headers = ["Dia", "Data", "Entrada", "Saída", "Ass.", "Entrada", "Saída", "Ass.", "Observações"];
  headers.forEach((h, i) => {
    drawCentered(page, h, xs[i], widths[i], headY, 8, bold);
  });

  let totalMinutes = 0;
  let hiddenSaturdays = false;

  for (let day = 1; day <= daysInMonth; day++) {
    const rowTop = bodyTop - (day - 1) * rowH;
    const textY = rowTop - rowH + 4.5;
    const weekday = new Date(Date.UTC(year, monthNumber - 1, day)).getUTCDay();
    const isWeekend = weekday === 0 || weekday === 6;
    const isSaturday = weekday === 6;

    if (isWeekend) {
      page.drawRectangle({
        x: x0, y: rowTop - rowH, width: tableRight - x0, height: rowH,
        color: weekendFill,
      });
    }

    drawCentered(page, WEEKDAY_LABELS[weekday], xs[0], widths[0], textY, 8, isWeekend ? bold : font);
    drawCentered(page, String(day), xs[1], widths[1], textY, 8, font);

    const dayEntries = byDay.get(day) ?? [];
    const get = (type: string) => dayEntries.find((e) => e.entry_type === type);
    const entrada = get("entrada");
    const saidaAlmoco = get("saida_almoco");
    const voltaAlmoco = get("volta_almoco");
    const saida = get("saida");

    const holidayKey = `${String(monthNumber).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const holiday = holidays.get(holidayKey);

    const skipSaturday = isSaturday && !input.includeSaturdays;
    if (skipSaturday && dayEntries.length > 0) hiddenSaturdays = true;

    if (dayEntries.length > 0 && !skipSaturday) {
      // Manhã: entrada → saída almoço; Tarde: volta → saída.
      // Sem registos de almoço: entrada na manhã, saída na tarde.
      const morningIn = entrada ? roundedMinutes(entrada.created_at) : null;
      const morningOut = saidaAlmoco ? roundedMinutes(saidaAlmoco.created_at) : null;
      const afternoonIn = voltaAlmoco ? roundedMinutes(voltaAlmoco.created_at) : null;
      const afternoonOut = saida ? roundedMinutes(saida.created_at) : null;

      if (morningIn !== null) drawCentered(page, minutesToText(morningIn), xs[2], widths[2], textY, 8, font);
      if (morningOut !== null) drawCentered(page, minutesToText(morningOut), xs[3], widths[3], textY, 8, font);
      if (afternoonIn !== null) drawCentered(page, minutesToText(afternoonIn), xs[5], widths[5], textY, 8, font);
      if (afternoonOut !== null) drawCentered(page, minutesToText(afternoonOut), xs[6], widths[6], textY, 8, font);

      // total do dia a partir das horas impressas (coerência com a folha)
      if (morningIn !== null && afternoonOut !== null) {
        if (morningOut !== null && afternoonIn !== null) {
          totalMinutes += morningOut - morningIn + (afternoonOut - afternoonIn);
        } else {
          totalMinutes += afternoonOut - morningIn;
        }
      }
      if (holiday) {
        drawCentered(page, holiday, xs[8], widths[8], textY, 7, font, gray);
      }
    } else if (holiday) {
      ["---", "---", "---", "---"].forEach((dash, i) => {
        const col = [2, 3, 5, 6][i];
        drawCentered(page, dash, xs[col], widths[col], textY, 8, font, gray);
      });
      drawCentered(page, holiday, xs[8], widths[8], textY, 7, font, gray);
    }
  }

  // grelha
  const bodyBottom = bodyTop - daysInMonth * rowH;
  for (let r = 0; r <= daysInMonth; r++) {
    const y = bodyTop - r * rowH;
    page.drawLine({ start: { x: x0, y }, end: { x: tableRight, y }, thickness: 0.5, color: line });
  }
  page.drawLine({ start: { x: x0, y: headY + 10 }, end: { x: tableRight, y: headY + 10 }, thickness: 0.7, color: line });
  xs.forEach((x) => {
    page.drawLine({ start: { x, y: headY + 10 }, end: { x, y: bodyBottom }, thickness: 0.5, color: line });
  });

  // ---------- rodapé ----------
  const totalHours = Math.floor(totalMinutes / 60);
  const totalRest = totalMinutes % 60;
  let totalText = `Total do mês: ${totalHours}h${String(totalRest).padStart(2, "0")}`;
  if (hiddenSaturdays) totalText += "  (sábados não apontados)";
  page.drawText(totalText, { x: x0, y: bodyBottom - 20, size: 10, font: bold, color: black });

  page.drawText("Assinatura do funcionário: ______________________________", {
    x: x0, y: bodyBottom - 48, size: 10, font, color: black,
  });
  page.drawText("Data: ____ / ____ / ________", {
    x: 410, y: bodyBottom - 48, size: 10, font, color: black,
  });

  page.drawText(
    "Horas arredondadas aos 15 minutos. Hora de Portugal (Europe/Lisbon).",
    { x: x0, y: bodyBottom - 70, size: 7, font, color: gray }
  );

  return pdf.save();
}
