import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// A ordem natural de um dia de trabalho.
const ORDEM = ["entrada", "saida_almoco", "volta_almoco", "saida"] as const;

const NOME: Record<string, string> = {
  entrada: "entrada",
  saida_almoco: "saída para almoço",
  volta_almoco: "volta do almoço",
  saida: "saída",
};

function hhmm(iso: string): string {
  return new Intl.DateTimeFormat("pt-PT", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Lisbon",
  }).format(new Date(iso));
}

// Confirma que, com esta alteração, os movimentos do dia continuam por
// ordem: entrada < saída almoço < volta almoço < saída.
//
// Sem esta verificação, uma hora editada na linha errada baralhava o dia
// sem aviso — o almoço a acabar antes de começar, a saída antes da volta
// — e as horas saíam negativas ou inchadas, tanto na grelha como na folha
// de presença que o funcionário assina.
//
// Devolve null se estiver tudo bem, ou a frase que explica o problema.
export async function verificarOrdemDoDia(
  admin: SupabaseClient,
  employeeId: string,
  entryDate: string,
  alteracao: { id?: string; entryType: string; iso: string }
): Promise<string | null> {
  const { data } = await admin
    .from("time_entries")
    .select("id, entry_type, created_at")
    .eq("employee_id", employeeId)
    .eq("entry_date", entryDate)
    .is("rejected_at", null);

  const horas = new Map<string, string>();
  for (const e of (data ?? []) as {
    id: string;
    entry_type: string;
    created_at: string;
  }[]) {
    if (alteracao.id && e.id === alteracao.id) continue;
    horas.set(e.entry_type, e.created_at);
  }
  horas.set(alteracao.entryType, alteracao.iso);

  // Comparar instantes, nunca texto: a base de dados devolve as horas
  // como "...+00:00" e a rota gera "....000Z". Comparadas como texto,
  // duas horas iguais davam resultados diferentes conforme a origem.
  const ms = (t: string) => new Date(horas.get(t)!).getTime();

  const presentes = ORDEM.filter((t) => horas.has(t));
  for (let i = 1; i < presentes.length; i++) {
    const antes = presentes[i - 1];
    const depois = presentes[i];
    // Horas IGUAIS são permitidas: "tudo às 17:00" é o padrão dos dias
    // fechados pela gestão (almoço de duração zero, inconfundível).
    // Só se recusa andar para trás.
    if (ms(depois) < ms(antes)) {
      return (
        `A ${NOME[depois]} (${hhmm(horas.get(depois)!)}) ficava antes ` +
        `da ${NOME[antes]} (${hhmm(horas.get(antes)!)}). ` +
        `Confirma que estás a mudar a linha certa.`
      );
    }
  }
  return null;
}
