// Fila de registos offline: guardados no IndexedDB do telemóvel quando não
// há rede e sincronizados automaticamente quando a ligação volta.
// O servidor marca estes registos com synced_offline=true e a flag
// offline_sync, e usa a hora do telemóvel para a data (revisão pela gestão).
import { createClient } from "@/lib/supabase/client";
import type { PendingEntry, TimeEntry } from "@/types";

const DB_NAME = "ponto-offline";
const STORE = "pending";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = run(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      })
  );
}

export function addPending(entry: PendingEntry): Promise<IDBValidKey> {
  return tx("readwrite", (store) => store.add(entry));
}

export function getPending(): Promise<PendingEntry[]> {
  return tx("readonly", (store) => store.getAll() as IDBRequest<PendingEntry[]>);
}

export function removePending(id: string): Promise<undefined> {
  return tx("readwrite", (store) => store.delete(id) as IDBRequest<undefined>);
}

// Heurística: o erro parece falta de rede (e não um erro do servidor)?
export function looksOffline(error: { message?: string } | null): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  const message = error?.message?.toLowerCase() ?? "";
  return (
    message.includes("fetch") ||
    message.includes("network") ||
    message.includes("load failed")
  );
}

// Tenta enviar todos os registos pendentes. Devolve os que ficaram gravados
// no servidor. Pára ao primeiro erro de rede (tenta de novo mais tarde).
export async function syncPending(): Promise<TimeEntry[]> {
  const items = await getPending();
  if (items.length === 0) return [];

  const supabase = createClient();
  const synced: TimeEntry[] = [];

  for (const item of items) {
    const path = `${item.employee_id}/${item.entry_date}_${item.entry_type}_off_${item.id}.jpg`;

    const { error: uploadError } = await supabase.storage
      .from("selfies")
      .upload(path, item.photo, { contentType: "image/jpeg" });
    // "already exists" = tentativa anterior já subiu a foto; podemos continuar.
    if (uploadError && !/exist|duplicate/i.test(uploadError.message ?? "")) {
      if (looksOffline(uploadError)) break;
      continue; // erro não-rede neste item; tenta os seguintes
    }

    const { data, error: insertError } = await supabase
      .from("time_entries")
      .insert({
        employee_id: item.employee_id,
        entry_type: item.entry_type,
        photo_path: path,
        latitude: item.latitude,
        longitude: item.longitude,
        gps_accuracy: item.gps_accuracy,
        client_timestamp: item.client_timestamp,
        synced_offline: true,
      })
      .select()
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        // já existe um registo deste tipo nesse dia — descarta o duplicado
        await removePending(item.id);
        continue;
      }
      if (looksOffline(insertError)) break;
      continue;
    }

    await removePending(item.id);
    synced.push(data as TimeEntry);
  }

  return synced;
}
