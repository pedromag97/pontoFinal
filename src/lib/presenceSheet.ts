import "server-only";
import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from "pdf-lib";
import { WORKSITE_TZ } from "@/lib/format";
import type { TimeEntry } from "@/types";

// Folha de presença mensal em PDF (layout tipo "Registre de Présence"):
// uma linha por dia do mês, blocos Manhã (entrada → saída almoço) e
// Tarde (volta almoço → saída), e coluna "Local" com o concelho do
// primeiro registo do dia. Horas arredondadas aos 15 minutos.
// Sábados só saem se include_saturdays; feriados vêm da tabela holidays.

interface SheetInput {
  employeeName: string;
  month: string; // YYYY-MM
  worksiteName: string | null;
  entries: TimeEntry[];
  includeSaturdays: boolean;
  holidaysByDay: Record<number, string>; // dia do mês → nome do feriado
  localityByDay: Record<number, string>; // dia do mês → concelho
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

export async function buildPresenceSheet(
  input: SheetInput
): Promise<Uint8Array> {
  const [year, monthNumber] = input.month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();

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

  // ---------- tabela (sem colunas Ass.) ----------
  const x0 = 40;
  const widths = [30, 26, 62, 62, 62, 62, 211];
  const xs: number[] = [x0];
  for (const w of widths) xs.push(xs[xs.length - 1] + w);
  const tableRight = xs[xs.length - 1];

  const groupY = 712; // linha "MANHÃ / TARDE"
  const headY = 696; // linha Entrada/Saída/Local
  const rowH = 15.6;
  const bodyTop = headY - 4;

  drawCentered(page, "1º — MANHÃ", xs[2], widths[2] + widths[3], groupY + 3, 9, bold);
  drawCentered(page, "2º — TARDE", xs[4], widths[4] + widths[5], groupY + 3, 9, bold);

  const headers = ["Dia", "Data", "Entrada", "Saída", "Entrada", "Saída", "Local"];
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

    const holiday = input.holidaysByDay[day];
    const locality = input.localityByDay[day];

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
      if (afternoonIn !== null) drawCentered(page, minutesToText(afternoonIn), xs[4], widths[4], textY, 8, font);
      if (afternoonOut !== null) drawCentered(page, minutesToText(afternoonOut), xs[5], widths[5], textY, 8, font);

      // total do dia a partir das horas impressas (coerência com a folha)
      if (morningIn !== null && afternoonOut !== null) {
        if (morningOut !== null && afternoonIn !== null) {
          totalMinutes += morningOut - morningIn + (afternoonOut - afternoonIn);
        } else {
          totalMinutes += afternoonOut - morningIn;
        }
      }

      const localText = locality ?? "";
      const suffix = holiday ? (localText ? `${localText} — ${holiday}` : holiday) : localText;
      if (suffix) {
        drawCentered(page, suffix.slice(0, 48), xs[6], widths[6], textY, 7, font);
      }
    } else if (holiday) {
      [2, 3, 4, 5].forEach((col) => {
        drawCentered(page, "---", xs[col], widths[col], textY, 8, font, gray);
      });
      drawCentered(page, holiday.slice(0, 48), xs[6], widths[6], textY, 7, font, gray);
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
