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

type Admin = ReturnType<typeof createAdminClient>;

// Devolve a resposta de recusa, ou null se o registo pode seguir.
async function verificarRegras(
  admin: Admin,
  employeeId: string,
  deviceUid: string | null
): Promise<NextResponse | null> {
  const { count } = await admin
    .from("webauthn_credentials")
    .select("id", { count: "exact", head: true })
    .eq("employee_id", employeeId);
  if ((count ?? 0) > 0) {
    return NextResponse.json(
      {
        error: "ja_tem_aparelho",
        mensagem:
          "Já tens um telemóvel associado a esta conta. Para trocar de aparelho, pede à gestão para remover o antigo.",
      },
      { status: 409 }
    );
  }

  if (deviceUid) {
    const { data: doutro } = await admin
      .from("webauthn_credentials")
      .select("employee_id")
      .eq("device_uid", deviceUid)
      .maybeSingle();
    if (doutro && doutro.employee_id !== employeeId) {
      return NextResponse.json(
        {
          error: "aparelho_de_outra_conta",
          mensagem:
            "Este telemóvel já está associado a outro funcionário. Cada aparelho só pode ser usado por uma pessoa.",
        },
        { status: 409 }
      );
    }
  }

  return null;
}

// Registo do telemóvel do funcionário (uma vez por aparelho).
// GET  → opções para o browser criar a chave
// POST → confirma a resposta e guarda a chave pública
//
// Duas regras, verificadas nos dois passos: uma conta só tem um aparelho,
// e um aparelho só serve uma conta (senão bastava alguém registar o seu
// telemóvel também na conta do colega e picar pelos dois).
export async function GET(request: Request) {
  const session = await getSessionProfile();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { profile } = session;
  const { rpID, rpName } = rpFromRequest(request);
  const admin = createAdminClient();

  const deviceUid = new URL(request.url).searchParams.get("aparelho");
  const conflito = await verificarRegras(admin, profile.id, deviceUid);
  // Verificar antes de pedir a digital, para o erro aparecer já e não
  // depois de a pessoa encostar o dedo.
  if (conflito) return conflito;

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
    aparelho?: string;
  } | null;
  if (!body?.resposta) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  // Repetir a verificação aqui: o GET é só para dar o erro cedo, este é
  // que conta (nada impede alguém de chamar o POST diretamente).
  const conflito = await verificarRegras(
    admin,
    profile.id,
    body.aparelho ?? null
  );
  if (conflito) return conflito;

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

  const { credential, credentialDeviceType, credentialBackedUp } =
    verificacao.registrationInfo;
  const { error } = await admin.from("webauthn_credentials").insert({
    employee_id: profile.id,
    credential_id: credential.id,
    public_key: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
    device_label: body.etiqueta?.slice(0, 60) ?? null,
    device_uid: body.aparelho?.slice(0, 64) ?? null,
    // multiDevice = chave sincronizada na conta iCloud/Google, por isso
    // pode aparecer noutro aparelho do próprio. A gestão vê isto na lista.
    device_type: credentialDeviceType,
    backed_up: credentialBackedUp,
  });
  await admin
    .from("punch_challenges")
    .update({ used_at: new Date().toISOString() })
    .eq("id", desafio.id);

  if (error) {
    // Corrida entre dois pedidos: os índices únicos são a última defesa.
    const duplicado = /duplicate key|unique/i.test(error.message);
    return NextResponse.json(
      {
        error: duplicado ? "ja_registado" : error.message,
        mensagem: duplicado
          ? "Este telemóvel ou esta conta já têm registo. Fala com a gestão."
          : undefined,
      },
      { status: duplicado ? 409 : 500 }
    );
  }
  return NextResponse.json({ ok: true });
}
