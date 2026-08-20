import { NextResponse } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { getSessionProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { rpFromRequest } from "@/lib/webauthn";
import type { EntryType } from "@/types";

export const runtime = "nodejs";

const TIPOS: EntryType[] = ["entrada", "saida_almoco", "volta_almoco", "saida"];

// Criação de um registo de ponto. Passa tudo por aqui (o cliente já não
// insere na base de dados diretamente) para o servidor poder exigir:
//  - a assinatura da impressão digital, quando há telemóvel registado;
//  - a selfie, quando a política do desafio a exigiu.
// Registos offline entram por um caminho próprio: sem desafio possível,
// exigem sempre selfie e ficam sinalizados para revisão.
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
  const latitude = Number(body?.latitude);
  const longitude = Number(body?.longitude);
  const photoPath = typeof body?.photo_path === "string" ? body.photo_path : null;
  const offline = body?.synced_offline === true;

  if (
    !TIPOS.includes(entryType) ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  // A foto tem de ser do próprio (o Storage já o impõe; aqui é a 2ª barreira).
  if (photoPath && !photoPath.startsWith(`${profile.id}/`)) {
    return NextResponse.json({ error: "foto inválida" }, { status: 400 });
  }

  const admin = createAdminClient();

  if (offline) {
    // Sem rede não houve desafio nem assinatura possível: exige-se a selfie,
    // e o trigger marca o registo como offline (nunca auto-validado).
    if (!photoPath) {
      return NextResponse.json(
        { error: "Registo offline exige fotografia." },
        { status: 400 }
      );
    }
  } else {
    const { data: desafio } = await admin
      .from("punch_challenges")
      .select("*")
      .eq("id", body?.challenge_id ?? "")
      .eq("employee_id", profile.id)
      .maybeSingle();

    if (
      !desafio ||
      desafio.used_at ||
      new Date(desafio.expires_at as string) < new Date() ||
      desafio.entry_type !== entryType
    ) {
      return NextResponse.json(
        { error: "Pedido expirado. Tenta registar de novo." },
        { status: 400 }
      );
    }

    if (desafio.requires_photo && !photoPath) {
      return NextResponse.json(
        { error: "Este registo precisa de fotografia." },
        { status: 400 }
      );
    }

    // Assinatura da impressão digital, quando o funcionário tem dispositivo.
    const { data: credenciais } = await admin
      .from("webauthn_credentials")
      .select("*")
      .eq("employee_id", profile.id);

    if ((credenciais ?? []).length > 0) {
      const resposta = body?.assertion as AuthenticationResponseJSON | undefined;
      if (!resposta) {
        return NextResponse.json(
          { error: "Falta a confirmação por impressão digital." },
          { status: 400 }
        );
      }
      const credencial = (credenciais ?? []).find(
        (c) => c.credential_id === resposta.id
      );
      if (!credencial) {
        return NextResponse.json(
          { error: "Dispositivo não reconhecido." },
          { status: 400 }
        );
      }

      const { rpID, origin } = rpFromRequest(request);
      let verificacao;
      try {
        verificacao = await verifyAuthenticationResponse({
          response: resposta,
          expectedChallenge: desafio.challenge as string,
          expectedOrigin: origin,
          expectedRPID: rpID,
          requireUserVerification: true,
          credential: {
            id: credencial.credential_id as string,
            publicKey: new Uint8Array(
              Buffer.from(credencial.public_key as string, "base64url")
            ),
            counter: Number(credencial.counter),
          },
        });
      } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 400 });
      }
      if (!verificacao.verified) {
        return NextResponse.json(
          { error: "Confirmação inválida." },
          { status: 400 }
        );
      }

      await admin
        .from("webauthn_credentials")
        .update({
          counter: verificacao.authenticationInfo.newCounter,
          last_used_at: new Date().toISOString(),
        })
        .eq("id", credencial.id);
    }

    await admin
      .from("punch_challenges")
      .update({ used_at: new Date().toISOString() })
      .eq("id", desafio.id);
  }

  const { data: criado, error } = await admin
    .from("time_entries")
    .insert({
      employee_id: profile.id,
      entry_type: entryType,
      photo_path: photoPath,
      latitude,
      longitude,
      gps_accuracy: Number.isFinite(Number(body?.gps_accuracy))
        ? Number(body.gps_accuracy)
        : null,
      client_timestamp:
        typeof body?.client_timestamp === "string" ? body.client_timestamp : null,
      synced_offline: offline,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "duplicado" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // O pedido de selfie da gestão só se consome aqui, quando existe mesmo
  // um registo com foto. Consumi-lo ao emitir o desafio deixava fugir:
  // bastava pedir desafio, ver que pedia foto, desistir, e pedir outro.
  if (photoPath) {
    await admin
      .from("selfie_requests")
      .update({
        consumed_at: new Date().toISOString(),
        consumed_entry_id: criado.id,
      })
      .eq("employee_id", profile.id)
      .is("consumed_at", null);
  }

  return NextResponse.json({ entry: criado });
}
