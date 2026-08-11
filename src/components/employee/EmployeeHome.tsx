"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getDictionary } from "@/lib/i18n";
import { formatDate, formatTime, todayWorksite, weekdayWorksite } from "@/lib/format";
import {
  addPending,
  getPending,
  looksOffline,
  syncPending,
} from "@/lib/offline";
import { enablePush, pushSupported } from "@/lib/push";
import type {
  EntryType,
  LunchScheduleDay,
  PendingEntry,
  Profile,
  TimeEntry,
} from "@/types";
import CameraCapture from "./CameraCapture";
import ConsentScreen from "./ConsentScreen";
import LogoutButton from "@/components/LogoutButton";

const t = getDictionary("pt");

type Step = "home" | "capture" | "preview" | "success";

interface Position {
  latitude: number;
  longitude: number;
  accuracy: number;
}

export default function EmployeeHome({
  profile,
  initialEntries,
  lunchSchedule,
}: {
  profile: Profile;
  initialEntries: TimeEntry[];
  lunchSchedule: LunchScheduleDay[];
}) {
  // Data/dia calculados no cliente: quando a página vem do cache offline,
  // o "hoje" do servidor pode estar desatualizado.
  const today = todayWorksite();
  const lunchRequired =
    lunchSchedule.find((d) => d.weekday === weekdayWorksite())
      ?.lunch_required ?? false;

  const [entries, setEntries] = useState<TimeEntry[]>(
    initialEntries.filter((e) => e.entry_date === today)
  );
  const [pending, setPending] = useState<PendingEntry[]>([]);
  const [consentAt, setConsentAt] = useState(profile.consent_given_at);
  const [step, setStep] = useState<Step>("home");
  const [entryType, setEntryType] = useState<EntryType>("entrada");
  const [photo, setPhoto] = useState<{ blob: Blob; dataUrl: string } | null>(
    null
  );
  const [position, setPosition] = useState<Position | null>(null);
  const [geoError, setGeoError] = useState(false);
  const [captureTime, setCaptureTime] = useState<Date | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastEntry, setLastEntry] = useState<TimeEntry | null>(null);
  const [lastWasOffline, setLastWasOffline] = useState(false);
  const geoRequestId = useRef(0);
  const syncing = useRef(false);
  const [pushBanner, setPushBanner] = useState<"hidden" | "ask" | "enabled">(
    "hidden"
  );

  // Lembretes push: mostra o convite quando suportado e ainda não decidido;
  // se a permissão já foi dada, garante silenciosamente que a subscrição existe.
  useEffect(() => {
    if (!pushSupported()) return;
    if (localStorage.getItem("push-dismissed") === "1") return;
    if (Notification.permission === "granted") {
      enablePush(profile.id);
      return;
    }
    if (Notification.permission === "default") setPushBanner("ask");
  }, [profile.id]);

  async function handleEnablePush() {
    const ok = await enablePush(profile.id);
    if (ok) {
      setPushBanner("enabled");
      setTimeout(() => setPushBanner("hidden"), 3000);
    } else {
      setPushBanner("hidden");
    }
  }

  function dismissPush() {
    localStorage.setItem("push-dismissed", "1");
    setPushBanner("hidden");
  }

  // ---------- sincronização offline ----------
  const runSync = useCallback(async () => {
    if (syncing.current) return;
    syncing.current = true;
    try {
      const synced = await syncPending();
      if (synced.length > 0) {
        const todayNow = todayWorksite();
        setEntries((prev) => {
          const fresh = synced.filter(
            (e) =>
              e.entry_date === todayNow &&
              !prev.some((p) => p.entry_type === e.entry_type)
          );
          return [...prev, ...fresh];
        });
      }
      setPending(await getPending());
    } catch {
      // IndexedDB indisponível — segue sem fila offline
    } finally {
      syncing.current = false;
    }
  }, []);

  useEffect(() => {
    runSync();
    window.addEventListener("online", runSync);
    return () => window.removeEventListener("online", runSync);
  }, [runSync]);

  // Sequência do dia: com almoço obrigatório são 4 registos, senão 2.
  const sequence: EntryType[] = lunchRequired
    ? ["entrada", "saida_almoco", "volta_almoco", "saida"]
    : ["entrada", "saida"];
  const pendingToday = pending.filter((p) => p.entry_date === today);
  const doneTypes = new Set<EntryType>([
    ...entries.map((e) => e.entry_type),
    ...pendingToday.map((p) => p.entry_type),
  ]);
  const nextType = sequence.find((type) => !doneTypes.has(type));

  const requestLocation = useCallback(() => {
    setGeoError(false);
    setPosition(null);
    const id = ++geoRequestId.current;
    if (!("geolocation" in navigator)) {
      setGeoError(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (id !== geoRequestId.current) return;
        setPosition({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy),
        });
      },
      () => {
        if (id !== geoRequestId.current) return;
        setGeoError(true);
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 }
    );
  }, []);

  function startFlow(type: EntryType) {
    setEntryType(type);
    setPhoto(null);
    setError(null);
    setStep("capture");
    requestLocation(); // pedir GPS em paralelo com a câmara
  }

  function onPhotoCaptured(blob: Blob, dataUrl: string) {
    setPhoto({ blob, dataUrl });
    setCaptureTime(new Date());
    setStep("preview");
  }

  async function saveOffline(clientTimestamp: string) {
    if (!photo || !position) return false;
    const item: PendingEntry = {
      id: crypto.randomUUID(),
      employee_id: profile.id,
      entry_type: entryType,
      entry_date: today,
      latitude: position.latitude,
      longitude: position.longitude,
      gps_accuracy: position.accuracy,
      client_timestamp: clientTimestamp,
      photo: photo.blob,
    };
    try {
      await addPending(item);
    } catch {
      return false; // IndexedDB indisponível
    }
    setPending((prev) => [...prev, item]);
    setLastEntry(null);
    setLastWasOffline(true);
    setStep("success");
    return true;
  }

  async function confirmEntry() {
    if (!photo || !position || sending) return;
    setSending(true);
    setError(null);
    setLastWasOffline(false);

    const clientTimestamp = new Date().toISOString();

    // Sem rede à partida? Guarda logo localmente.
    if (!navigator.onLine) {
      const saved = await saveOffline(clientTimestamp);
      setSending(false);
      if (!saved) setError(t.errors.network);
      return;
    }

    const supabase = createClient();
    const path = `${profile.id}/${today}_${entryType}_${Date.now()}.jpg`;

    const { error: uploadError } = await supabase.storage
      .from("selfies")
      .upload(path, photo.blob, { contentType: "image/jpeg" });
    if (uploadError) {
      if (looksOffline(uploadError)) {
        const saved = await saveOffline(clientTimestamp);
        setSending(false);
        if (!saved) setError(t.errors.network);
        return;
      }
      setError(t.errors.upload);
      setSending(false);
      return;
    }

    const { data, error: insertError } = await supabase
      .from("time_entries")
      .insert({
        employee_id: profile.id,
        entry_type: entryType,
        photo_path: path,
        latitude: position.latitude,
        longitude: position.longitude,
        gps_accuracy: position.accuracy,
        client_timestamp: clientTimestamp,
      })
      .select()
      .single();

    if (insertError) {
      if (looksOffline(insertError)) {
        const saved = await saveOffline(clientTimestamp);
        setSending(false);
        if (!saved) setError(t.errors.network);
        return;
      }
      setError(
        insertError.code === "23505" ? t.errors.duplicate : t.errors.generic
      );
      setSending(false);
      return;
    }

    const entry = data as TimeEntry;
    setEntries((prev) => [...prev, entry]);
    setLastEntry(entry);
    setSending(false);
    setStep("success");
  }

  // ---------- consentimento RGPD (primeiro login) ----------
  if (!consentAt) {
    return (
      <ConsentScreen
        onAccepted={(iso) => setConsentAt(iso)}
        profileId={profile.id}
      />
    );
  }

  // ---------- captura ----------
  if (step === "capture") {
    return (
      <CameraCapture
        title={t.capture.titles[entryType]}
        onCapture={onPhotoCaptured}
        onCancel={() => setStep("home")}
      />
    );
  }

  // ---------- pré-visualização ----------
  if (step === "preview" && photo) {
    const lowAccuracy = position !== null && position.accuracy > 100;
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col p-4">
        <h1 className="mb-3 text-center text-lg font-bold">
          {t.preview.title}
        </h1>

        <img
          src={photo.dataUrl}
          alt="Selfie"
          className="mb-4 aspect-[3/4] w-full rounded-2xl object-cover shadow-sm"
        />

        <div className="mb-4 space-y-2 rounded-2xl bg-white p-4 text-sm shadow-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">{t.preview.time}</span>
            <span className="font-semibold">
              {captureTime ? formatTime(captureTime.toISOString()) : "—"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">{t.preview.location}</span>
            <span className="font-mono text-xs font-semibold">
              {position
                ? `${position.latitude.toFixed(5)}, ${position.longitude.toFixed(5)}`
                : t.preview.locationPending}
            </span>
          </div>
          {position && (
            <div className="flex justify-between">
              <span className="text-slate-500">{t.preview.accuracy}</span>
              <span
                className={`font-semibold ${lowAccuracy ? "text-amber-600" : "text-emerald-600"}`}
              >
                ±{position.accuracy} {t.preview.meters}
              </span>
            </div>
          )}
        </div>

        {lowAccuracy && (
          <p className="mb-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
            ⚠️ {t.preview.lowAccuracy}
          </p>
        )}

        {geoError && (
          <div className="mb-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            <p className="mb-2">{t.preview.locationError}</p>
            <button
              onClick={requestLocation}
              className="font-semibold underline"
            >
              {t.preview.retryLocation}
            </button>
          </div>
        )}

        {error && (
          <p className="mb-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="mt-auto space-y-3 pb-2">
          <button
            onClick={confirmEntry}
            disabled={!position || sending}
            className="w-full rounded-2xl bg-teal-700 py-4 text-lg font-bold text-white active:bg-teal-800 disabled:opacity-50"
          >
            {sending
              ? t.preview.sending
              : position
                ? t.preview.confirm
                : t.capture.gettingLocation}
          </button>
          <button
            onClick={() => startFlow(entryType)}
            disabled={sending}
            className="w-full rounded-2xl border border-slate-300 bg-white py-3.5 font-semibold text-slate-700 active:bg-slate-100"
          >
            {t.preview.retake}
          </button>
        </div>
      </main>
    );
  }

  // ---------- sucesso ----------
  if (step === "success") {
    const flagged =
      lastEntry !== null && Object.keys(lastEntry.flags ?? {}).length > 0;
    const successTime = lastEntry
      ? formatTime(lastEntry.created_at)
      : captureTime
        ? formatTime(captureTime.toISOString())
        : "";
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center p-6 text-center">
        <div
          className={`mb-4 flex h-20 w-20 items-center justify-center rounded-full text-4xl ${
            lastWasOffline ? "bg-amber-100" : "bg-emerald-100"
          }`}
        >
          {lastWasOffline ? "⏳" : "✅"}
        </div>
        <h1 className="mb-1 text-2xl font-bold">
          {t.success.registered[entryType]} {successTime}
        </h1>
        {lastWasOffline && (
          <p className="mt-3 max-w-xs rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
            📡 {t.success.offlineNote}
          </p>
        )}
        {flagged && (
          <p className="mt-3 max-w-xs rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
            ⚠️ {t.home.flaggedNotice}
          </p>
        )}
        <button
          onClick={() => setStep("home")}
          className="mt-8 w-full rounded-2xl bg-teal-700 py-4 text-lg font-bold text-white active:bg-teal-800"
        >
          {t.success.back}
        </button>
      </main>
    );
  }

  // ---------- ecrã inicial ----------
  const todayLog: {
    key: string;
    type: EntryType;
    time: string;
    pending: boolean;
    flagged: boolean;
  }[] = [
    ...entries.map((e) => ({
      key: e.id,
      type: e.entry_type,
      time: formatTime(e.created_at),
      pending: false,
      flagged: Object.keys(e.flags ?? {}).some((f) => f !== "photo_purged"),
    })),
    ...pendingToday.map((p) => ({
      key: p.id,
      type: p.entry_type,
      time: formatTime(p.client_timestamp),
      pending: true,
      flagged: false,
    })),
  ].sort((a, b) => a.time.localeCompare(b.time));

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col p-5">
      <header className="mb-6 flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-500">{t.home.hello},</p>
          <h1 className="text-2xl font-bold">{profile.full_name}</h1>
          <p className="mt-1 text-sm capitalize text-slate-500">
            {formatDate(today, "pt-PT")}
          </p>
        </div>
        <LogoutButton label={t.home.logout} />
      </header>

      {pushBanner === "ask" && (
        <div className="mb-5 rounded-2xl bg-white p-4 shadow-sm">
          <p className="font-semibold">🔔 {t.home.pushTitle}</p>
          <p className="mb-3 mt-1 text-sm text-slate-500">{t.home.pushBody}</p>
          <div className="flex gap-2">
            <button
              onClick={handleEnablePush}
              className="flex-1 rounded-xl bg-teal-700 py-2.5 text-sm font-semibold text-white active:bg-teal-800"
            >
              {t.home.pushEnable}
            </button>
            <button
              onClick={dismissPush}
              className="flex-1 rounded-xl border border-slate-300 py-2.5 text-sm font-semibold text-slate-600 active:bg-slate-100"
            >
              {t.home.pushLater}
            </button>
          </div>
        </div>
      )}
      {pushBanner === "enabled" && (
        <p className="mb-5 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
          {t.home.pushEnabled}
        </p>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3">
        {sequence.map((type) => {
          const sent = entries.find((e) => e.entry_type === type);
          const queued = pendingToday.find((p) => p.entry_type === type);
          return (
            <StatusCard
              key={type}
              label={t.types[type]}
              time={
                sent
                  ? formatTime(sent.created_at)
                  : queued
                    ? formatTime(queued.client_timestamp)
                    : null
              }
              pending={!sent && !!queued}
              emptyLabel={t.home.notYet}
            />
          );
        })}
      </div>

      {todayLog.length > 0 && (
        <section className="mb-5 rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t.home.todayList}
          </h2>
          <ul className="divide-y divide-slate-100">
            {todayLog.map((row) => (
              <li
                key={row.key}
                className="flex items-center justify-between py-2 text-sm"
              >
                <span className="font-medium">{t.types[row.type]}</span>
                <span className="flex items-center gap-2">
                  {row.flagged && <span title={t.home.flaggedNotice}>⚠️</span>}
                  {row.pending && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                      ⏳ {t.home.pendingBadge}
                    </span>
                  )}
                  <span className="font-bold">{row.time}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {pendingToday.length > 0 && (
        <p className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          📡 {t.home.pendingNotice}
        </p>
      )}

      <a
        href="/registo/folha"
        className="mb-5 block rounded-2xl bg-white py-3 text-center text-sm font-semibold text-teal-700 shadow-sm active:bg-slate-50"
      >
        📅 {t.home.monthSheet} →
      </a>

      <div className="flex flex-1 flex-col justify-center pb-10">
        {nextType ? (
          <BigButton
            label={t.home.actions[nextType]}
            emoji={t.home.actionEmojis[nextType]}
            onClick={() => startFlow(nextType)}
          />
        ) : (
          <p className="rounded-2xl bg-emerald-50 py-6 text-center text-xl font-bold text-emerald-700">
            {t.home.dayComplete}
          </p>
        )}
      </div>
    </main>
  );
}

function StatusCard({
  label,
  time,
  pending,
  emptyLabel,
}: {
  label: string;
  time: string | null;
  pending: boolean;
  emptyLabel: string;
}) {
  return (
    <div
      className={`rounded-2xl p-4 text-center shadow-sm ${
        time ? (pending ? "bg-amber-50" : "bg-emerald-50") : "bg-white"
      }`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p
        className={`mt-1 text-2xl font-bold ${
          time
            ? pending
              ? "text-amber-700"
              : "text-emerald-700"
            : "text-slate-300"
        }`}
      >
        {time ?? emptyLabel}
        {pending && time && <span className="ml-1 align-middle text-sm">⏳</span>}
      </p>
    </div>
  );
}

function BigButton({
  label,
  emoji,
  onClick,
}: {
  label: string;
  emoji: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-3xl bg-teal-700 py-8 text-xl font-bold text-white shadow-lg shadow-teal-700/20 active:bg-teal-800"
    >
      <span className="mb-1 block text-4xl">{emoji}</span>
      {label}
    </button>
  );
}
