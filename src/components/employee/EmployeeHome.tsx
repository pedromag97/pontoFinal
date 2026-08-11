"use client";

import { useCallback, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getDictionary } from "@/lib/i18n";
import { formatDate, formatTime } from "@/lib/format";
import type { EntryType, Profile, TimeEntry } from "@/types";
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
  today,
  lunchRequired,
}: {
  profile: Profile;
  initialEntries: TimeEntry[];
  today: string;
  lunchRequired: boolean;
}) {
  const [entries, setEntries] = useState<TimeEntry[]>(initialEntries);
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
  const geoRequestId = useRef(0);

  // Sequência do dia: com almoço obrigatório são 4 registos, senão 2.
  const sequence: EntryType[] = lunchRequired
    ? ["entrada", "saida_almoco", "volta_almoco", "saida"]
    : ["entrada", "saida"];
  const byType = new Map(entries.map((e) => [e.entry_type, e]));
  const nextType = sequence.find((type) => !byType.has(type));

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

  async function confirmEntry() {
    if (!photo || !position || sending) return;
    setSending(true);
    setError(null);

    const supabase = createClient();
    const path = `${profile.id}/${today}_${entryType}_${Date.now()}.jpg`;

    const { error: uploadError } = await supabase.storage
      .from("selfies")
      .upload(path, photo.blob, { contentType: "image/jpeg" });
    if (uploadError) {
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
        client_timestamp: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) {
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
              {captureTime
                ? captureTime.toLocaleTimeString("pt-PT", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "—"}
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
  if (step === "success" && lastEntry) {
    const flagged = Object.keys(lastEntry.flags ?? {}).length > 0;
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center p-6 text-center">
        <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-4xl">
          ✅
        </div>
        <h1 className="mb-1 text-2xl font-bold">
          {t.success.registered[lastEntry.entry_type]}{" "}
          {formatTime(lastEntry.created_at)}
        </h1>
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

      <div className="mb-8 grid grid-cols-2 gap-3">
        {sequence.map((type) => (
          <StatusCard
            key={type}
            label={t.types[type]}
            entry={byType.get(type)}
            emptyLabel={t.home.notYet}
          />
        ))}
      </div>

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
  entry,
  emptyLabel,
}: {
  label: string;
  entry: TimeEntry | undefined;
  emptyLabel: string;
}) {
  return (
    <div
      className={`rounded-2xl p-4 text-center shadow-sm ${entry ? "bg-emerald-50" : "bg-white"}`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p
        className={`mt-1 text-2xl font-bold ${entry ? "text-emerald-700" : "text-slate-300"}`}
      >
        {entry ? formatTime(entry.created_at) : emptyLabel}
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
