import { NextResponse } from "next/server";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { getSessionProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { rpFromRequest } from "@/lib/webauthn";

export const runtime = "nodejs";

// Registo do telemóvel do funcionário (uma vez por aparelho).
// GET  → opções para o browser criar a chave
// POST → confirma a resposta e guarda a chave pública
export async function GET(request: Request) {
  const session = await getSessionProfile();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { profile } = session;
  const { rpID, rpName } = rpFromRequest(request);
  const admin = createAdminClient();

  const { data: existentes } = await admin
    .from("webauthn_credentials")
    .select("credential_id")
    .eq("employee_id", profile.id);

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: profile.username ?? profile.full_name,
    userDisplayName: profile.full_name,
    attestationType: "none",
    // Não repetir o mesmo aparelho.
    excludeCredentials: (existentes ?? []).map((c) => ({
      id: c.credential_id as string,
    })),
    authenticatorSelection: {
      // Só o sensor do próprio telemóvel, e com desbloqueio obrigatório.
      authenticatorAttachment: "platform",
      residentKey: "preferred",
      userVerification: "required",
    },
  });

  // O desafio do registo fica guardado como um "punch_challenge" especial.
  await admin.from("punch_challenges").insert({
    employee_id: profile.id,
    challenge: options.challenge,
    entry_type: "registo_dispositivo",
    requires_photo: false,
    expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
  });

  return NextResponse.json(options);
}

export async function POST(request: Request) {
  const session = await getSessionProfile();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { profile } = session;
  const { rpID, origin } = rpFromRequest(request);
  const admin = createAdminClient();

  const body = (await request.json().catch(() => null)) as {
    resposta?: RegistrationResponseJSON;
    etiqueta?: string;
  } | null;
  if (!body?.resposta) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const { data: desafio } = await admin
    .from("punch_challenges")
    .select("id, challenge")
    .eq("employee_id", profile.id)
    .eq("entry_type", "registo_dispositivo")
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!desafio) {
    return NextResponse.json({ error: "desafio expirado" }, { status: 400 });
  }

  let verificacao;
  try {
    verificacao = await verifyRegistrationResponse({
      response: body.resposta,
      expectedChallenge: desafio.challenge as string,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 }
    );
  }

  if (!verificacao.verified || !verificacao.registrationInfo) {
    return NextResponse.json({ error: "não verificado" }, { status: 400 });
  }

  const { credential } = verificacao.registrationInfo;
  const { error } = await admin.from("webauthn_credentials").insert({
    employee_id: profile.id,
    credential_id: credential.id,
    public_key: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
    device_label: body.etiqueta?.slice(0, 60) ?? null,
  });
  await admin
    .from("punch_challenges")
    .update({ used_at: new Date().toISOString() })
    .eq("id", desafio.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
