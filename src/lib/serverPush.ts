import "server-only";
import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";

// Envia uma notificação push a todos os dispositivos de um utilizador.
// Devolve true se pelo menos um dispositivo a recebeu. Subscrições mortas
// (404/410) são removidas. Sem VAPID configurado, falha em silêncio.
export async function sendPushToUser(
  admin: SupabaseClient,
  userId: string,
  payload: { title: string; body: string; url?: string }
): Promise<boolean> {
  if (
    !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
    !process.env.VAPID_PRIVATE_KEY
  ) {
    return false;
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:noreply@ponto.lusocabo.com",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);
  if (!subs || subs.length === 0) return false;

  const body = JSON.stringify({ ...payload, url: payload.url ?? "/registo" });
  let delivered = false;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body
      );
      delivered = true;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await admin.from("push_subscriptions").delete().eq("id", sub.id);
      }
    }
  }
  return delivered;
}
