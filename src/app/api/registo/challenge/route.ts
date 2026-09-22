import { NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { getSessionProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  CHALLENGE_TTL_MIN,
  decidirSelfie,
  motivoParaCliente,
  rpFromRequest,
} from "@/lib/webauthn";
import type { EntryType } from "@/types";

export const runtime = "nodejs";

const TIPOS: EntryType[] = ["entrada", "saida_almoco", "volta_almoco", "saida"];

// Antes de cada picagem: o servidor decide se esta precisa de selfie e
// devolve o desafio que o telemóvel vai assinar com a impressão digital.
// A decisão fica guardada — o registo só é aceite se lhe corresponder.
export async function POST(request: Request) {
  const session = await getSessionProfile();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { profile } = session;
  if (!profile.active) {
    return NextResponse.json({ error: "conta desativada" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const entryType = body?.entry_type as EntryType;
  // A app já tentou a digital neste movimento e não conseguiu (chave
  // perdida no aparelho, sensor avariado). Em vez de a deixar encravada,
  // dá-se saída pela selfie — que é prova mais forte de identidade,
  // não mais fraca. Fica marcado e não é validado automaticamente.
  const semDigital = body?.sem_digital === true;
  const latitude = Number(body?.latitude);
  const longitude = Number(body?.longitude);
  if (
    !TIPOS.includes(entryType) ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { rpID } = rpFromRequest(request);

  const { data: credenciais } = await admin
    .from("webauthn_credentials")
    .select("credential_id")
    .eq("employee_id", profile.id);
  const temCredencial = (credenciais ?? []).length > 0;

  const politica = await decidirSelfie(admin, {
    employeeId: profile.id,
    latitude,
    longitude,
    temCredencial,
  });

  const options = temCredencial && !semDigital
    ? await generateAuthenticationOptions({
        rpID,
        userVerification: "required",
        // O cliente desiste aos 30s; pedir ao browser que faça o mesmo.
        timeout: 30_000,
        allowCredentials: (credenciais ?? []).map((c) => ({
          id: c.credential_id as string,
        })),
      })
    : null;

  // Sem dispositivo registado não há assinatura — o desafio serve na mesma
  // para o servidor saber que esta picagem foi autorizada com selfie.
  const challenge =
    options?.challenge ?? crypto.randomUUID().replace(/-/g, "");

  const { data: linha, error } = await admin
    .from("punch_challenges")
    .insert({
      employee_id: profile.id,
      challenge,
      entry_type: entryType,
      // A saída por selfie só vale a troco da foto.
      requires_photo: politica.requiresPhoto || semDigital,
      fingerprint_waived: semDigital && temCredencial,
      expires_at: new Date(Date.now() + CHALLENGE_TTL_MIN * 60_000).toISOString(),
    })
    .select("id")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    challengeId: linha.id,
    requiresPhoto: politica.requiresPhoto || semDigital,
    // O motivo verdadeiro fica só no servidor (ver motivoParaCliente).
    motivo: motivoParaCliente(politica.motivo),
    options, // null quando não há dispositivo registado
  });
}
