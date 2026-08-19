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
  latitude: number;
  longitude: number;
  temCredencial: boolean;
}

export interface PolicyResult {
  requiresPhoto: boolean;
  motivo: "sem_dispositivo" | "fora_de_obra" | "amostragem" | "nao_exigida";
}

// Quando é que a selfie ainda vale a pena? Fora de obra (é aí que a dúvida
// existe), sem telemóvel registado (não há outra prova), e por amostragem.
export async function decidirSelfie(
  admin: SupabaseClient,
  { latitude, longitude, temCredencial }: PolicyInput
): Promise<PolicyResult> {
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
