import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// GPS → concelho/comuna (para a coluna "Local" da folha de presença).
// Usa o Nominatim (OpenStreetMap) com cache em base de dados: coordenadas
// arredondadas a 2 casas (~1 km) — os dias na mesma zona partilham o cache,
// por isso na prática são 1-3 pedidos por funcionário/mês.
export async function concelhoFromCoords(
  admin: SupabaseClient,
  latitude: number,
  longitude: number
): Promise<string | null> {
  const key = `${latitude.toFixed(2)},${longitude.toFixed(2)}`;

  const { data: cached } = await admin
    .from("geocode_cache")
    .select("locality")
    .eq("key", key)
    .maybeSingle();
  if (cached) return cached.locality as string;

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=jsonv2&zoom=10&accept-language=pt`,
      {
        headers: {
          "User-Agent": "ponto-lusocabo/1.0 (pedromag997@gmail.com)",
        },
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      address?: Record<string, string>;
    };
    const address = body.address ?? {};
    const locality =
      address.city ??
      address.town ??
      address.village ??
      address.municipality ??
      address.county ??
      null;
    if (locality) {
      // corrida entre pedidos simultâneos é inofensiva (primary key)
      await admin
        .from("geocode_cache")
        .upsert({ key, locality }, { onConflict: "key" });
    }
    return locality;
  } catch {
    return null; // sem rede/timeout — a folha sai sem o local
  }
}
