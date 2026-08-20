import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// WebAuthn: a digital desbloqueia uma chave guardada no telemóvel e o
// servidor verifica a assinatura. Nenhum dado biométrico chega aqui.

// O "relying party" tem de ser o domínio do site (sem porta nem protocolo).
export function rpFromRequest(request: Request): {
  rpID: string;
  origin: string;
  rpName: string;
} {
  const origin =
    request.headers.get("origin") ??
    new URL(request.url).origin.replace(/^http:/, "https:");
  const rpID = new URL(origin).hostname;
  return { rpID, origin, rpName: "Ponto Final" };
}

export const CHALLENGE_TTL_MIN = 5;

// Um em cada N registos pede selfie mesmo estando tudo bem — o efeito
// dissuasor mantém-se sem guardar uma foto de cada picagem.
export const AMOSTRAGEM_SELFIE = 0.1;

function haversineM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const rad = Math.PI / 180;
  return (
    12742000 *
    Math.asin(
      Math.sqrt(
        Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
          Math.cos(lat1 * rad) *
            Math.cos(lat2 * rad) *
            Math.sin(((lon2 - lon1) * rad) / 2) ** 2
      )
    )
  );
}

export interface PolicyInput {
  employeeId: string;
  latitude: number;
  longitude: number;
  temCredencial: boolean;
}

export type Motivo =
  | "sem_dispositivo"
  | "fora_de_obra"
  | "pedido_gestao"
  | "amostragem"
  | "nao_exigida";

export interface PolicyResult {
  requiresPhoto: boolean;
  motivo: Motivo;
}

// O motivo que o telemóvel chega a ver. "pedido_gestao" vira "amostragem"
// de propósito: se o funcionário soubesse que a foto lhe foi pedida por
// alguém, quem está a tentar aldrabar sabia exatamente quando ter cuidado.
// O motivo verdadeiro fica guardado no desafio, do lado do servidor.
export function motivoParaCliente(motivo: Motivo): Motivo {
  return motivo === "pedido_gestao" ? "amostragem" : motivo;
}

// Quando é que a selfie ainda vale a pena? Fora de obra (é aí que a dúvida
// existe), sem telemóvel registado (não há outra prova), a pedido da
// gestão, e por amostragem.
export async function decidirSelfie(
  admin: SupabaseClient,
  { employeeId, latitude, longitude, temCredencial }: PolicyInput
): Promise<PolicyResult> {
  // Pedido da gestão: vale por cima de tudo o resto, para não haver
  // caminho nenhum em que a picagem seguinte escape sem foto.
  const { data: pedido } = await admin
    .from("selfie_requests")
    .select("id")
    .eq("employee_id", employeeId)
    .is("consumed_at", null)
    .maybeSingle();
  if (pedido) {
    return { requiresPhoto: true, motivo: "pedido_gestao" };
  }

  if (!temCredencial) {
    return { requiresPhoto: true, motivo: "sem_dispositivo" };
  }

  const { data: worksites } = await admin
    .from("worksites")
    .select("latitude, longitude, radius_m")
    .eq("active", true)
    .eq("mobile", false);

  const dentro = (worksites ?? []).some(
    (w) =>
      w.latitude !== null &&
      w.longitude !== null &&
      haversineM(latitude, longitude, w.latitude, w.longitude) <= w.radius_m
  );
  // Sem obras fixas configuradas não há como saber onde é "dentro":
  // nesse caso a selfie continua a ser a única prova de local.
  if (!worksites || worksites.length === 0 || !dentro) {
    return { requiresPhoto: true, motivo: "fora_de_obra" };
  }

  if (Math.random() < AMOSTRAGEM_SELFIE) {
    return { requiresPhoto: true, motivo: "amostragem" };
  }
  return { requiresPhoto: false, motivo: "nao_exigida" };
}
