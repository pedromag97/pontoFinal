"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getDictionary } from "@/lib/i18n";
import {
  formatDate,
  formatHoursMinutes,
  formatTime,
  todayWorksite,
  weekdayWorksite,
  workedSoFar,
} from "@/lib/format";
import {
  addPending,
  getPending,
  looksOffline,
  syncPending,
} from "@/lib/offline";
import { enablePush, pushSupported } from "@/lib/push";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type {
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import type {
  AbsenceKind,
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

type Step = "home" | "preparing" | "capture" | "preview" | "success";

// O que o servidor decidiu para esta picagem: se pede selfie e, quando o
// telemóvel está registado, o desafio a assinar com a impressão digital.
interface Desafio {
  challengeId: string | null;
  requiresPhoto: boolean;
  motivo?: string;
  options: PublicKeyCredentialRequestOptionsJSON | null;
}

interface Position {
  latitude: number;
  longitude: number;
  accuracy: number;
}

export default function EmployeeHome({
  profile,
  initialEntries,
  rejectedToday = [],
  lunchSchedule,
  absence = null,
  hasCredential = false,
}: {
  profile: Profile;
  initialEntries: TimeEntry[];
  rejectedToday?: { entry_type: EntryType; rejection_reason: string | null }[];
  lunchSchedule: LunchScheduleDay[];
  absence?: { kind: AbsenceKind; end_date: string } | null;
  hasCredential?: boolean;
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
  // Porque falhou o GPS. A diferença importa: "negado" é permissão do
  // browser e o botão de repetir nunca resolve — a pessoa tem de ir às
  // definições. "indisponível" é o GPS do telemóvel desligado ou sem
  // sinal, e aí repetir faz sentido.
  const [geoCausa, setGeoCausa] = useState<"negado" | "indisponivel" | null>(
    null
  );
  // Estado do GPS visto do ecrã inicial, antes de a pessoa se meter no
  // fluxo. Sem isto, só se descobre que o GPS está desligado depois de
  // carregar em "Registar" — e aí já é tarde.
  const [gpsAviso, setGpsAviso] = useState<"negado" | "indisponivel" | null>(
    null
  );
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
  const [desafio, setDesafio] = useState<Desafio | null>(null);
  const [temCredencial, setTemCredencial] = useState(hasCredential);
  const [enrollBanner, setEnrollBanner] = useState<
    "hidden" | "ask" | "done" | "error"
  >("hidden");
  const [enrollErro, setEnrollErro] = useState<string | null>(null);
  // Relógio do cartão principal. Só minutos, por isso um tique de 15s
  // chega e não gasta bateria a redesenhar o ecrã a cada segundo.
  const [agora, setAgora] = useState<Date | null>(null);
  useEffect(() => {
    setAgora(new Date());
    const id = setInterval(() => setAgora(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);

  // Convite para registar o telemóvel (uma vez por aparelho).
  useEffect(() => {
    if (temCredencial) return;
    if (typeof window === "undefined" || !window.PublicKeyCredential) return;
    if (localStorage.getItem("enroll-dismissed") === "1") return;
    setEnrollBanner("ask");
  }, [temCredencial]);

  // Identificador deste aparelho, criado à primeira vez e guardado no
  // browser. Não identifica a pessoa — serve só para o servidor recusar
  // que duas contas se registem no mesmo telemóvel.
  function idDoAparelho(): string {
    const chave = "ponto-aparelho";
    let id = localStorage.getItem(chave);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(chave, id);
    }
    return id;
  }

  async function registarDispositivo() {
    const aparelho = idDoAparelho();
    try {
      const res = await fetch(
        `/api/webauthn/register?aparelho=${encodeURIComponent(aparelho)}`
      );
      if (!res.ok) {
        const erro = await res.json().catch(() => null);
        throw new Error(erro?.mensagem ?? "");
      }
      const options = await res.json();
      const resposta = await startRegistration({ optionsJSON: options });
      const guardar = await fetch("/api/webauthn/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resposta,
          etiqueta: navigator.platform,
          aparelho,
        }),
      });
      if (!guardar.ok) {
        const erro = await guardar.json().catch(() => null);
        throw new Error(erro?.mensagem ?? "");
      }
      setTemCredencial(true);
      setEnrollBanner("done");
      setTimeout(() => setEnrollBanner("hidden"), 4000);
    } catch (e) {
      setEnrollErro((e as Error).message || null);
      setEnrollBanner("error");
    }
  }

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
    setGeoCausa(null);
    setPosition(null);
    const id = ++geoRequestId.current;
    if (!("geolocation" in navigator)) {
      setGeoError(true);
      setGeoCausa("indisponivel");
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
        setGpsAviso(null);
      },
      (err) => {
        if (id !== geoRequestId.current) return;
        setGeoError(true);
        setGeoCausa(err.code === 1 ? "negado" : "indisponivel");
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 }
    );
  }, []);

  // Verificar o GPS no ecrã inicial, para o problema aparecer antes de a
  // pessoa carregar em "Registar" e ficar encalhada no meio do fluxo.
  //
  // Só confirmamos quando a permissão JÁ foi dada: nesse caso o pedido é
  // silencioso e serve também para aquecer a posição. Com a permissão por
  // decidir não pedimos nada aqui — a caixa do browser deve aparecer no
  // momento da picagem, que é quando faz sentido para quem a vê.
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    if (!("geolocation" in navigator)) {
      setGpsAviso("indisponivel");
      return;
    }
    if (!navigator.permissions?.query) return;

    let vivo = true;
    let estado: PermissionStatus | null = null;

    function verificar() {
      if (!vivo || !estado) return;
      if (estado.state === "denied") {
        setGpsAviso("negado");
        return;
      }
      if (estado.state !== "granted") {
        setGpsAviso(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        () => vivo && setGpsAviso(null),
        // Permissão dada mas sem posição: GPS do telemóvel desligado.
        () => vivo && setGpsAviso("indisponivel"),
        { timeout: 15000, maximumAge: 60000 }
      );
    }

    navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((p) => {
        if (!vivo) return;
        estado = p;
        p.addEventListener("change", verificar);
        verificar();
      })
      .catch(() => {});

    // A pessoa sai para as definições a ligar o GPS e volta: reavaliar.
    function aoVoltar() {
      if (document.visibilityState === "visible") verificar();
    }
    document.addEventListener("visibilitychange", aoVoltar);

    return () => {
      vivo = false;
      estado?.removeEventListener("change", verificar);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, []);

  // O GPS é preciso ANTES de saber se esta picagem leva selfie: é ele que
  // diz se o funcionário está dentro de uma obra.
  function obterPosicao(): Promise<Position> {
    return new Promise((resolve, reject) => {
      if (!("geolocation" in navigator)) {
        setGeoError(true);
        setGeoCausa("indisponivel");
        reject(new Error("sem gps"));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const p = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: Math.round(pos.coords.accuracy),
          };
          setPosition(p);
          setGeoError(false);
          setGeoCausa(null);
          setGpsAviso(null);
          resolve(p);
        },
        (err) => {
          setGeoError(true);
          // code 1 = PERMISSION_DENIED
          setGeoCausa(err.code === 1 ? "negado" : "indisponivel");
          reject(err);
        },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 }
      );
    });
  }

  // Sem rede (ou sem resposta do servidor) não há desafio possível:
  // exige-se selfie e o registo segue pela fila offline.
  const desafioOffline: Desafio = {
    challengeId: null,
    requiresPhoto: true,
    options: null,
  };

  async function startFlow(type: EntryType) {
    setEntryType(type);
    setPhoto(null);
    setError(null);
    setDesafio(null);
    setPosition(null);
    setStep("preparing");

    let pos: Position;
    try {
      pos = await obterPosicao();
    } catch {
      setStep("preview"); // ecrã de erro de GPS, com botão de repetir
      return;
    }

    if (!navigator.onLine) {
      setDesafio(desafioOffline);
      setStep("capture");
      return;
    }

    try {
      const res = await fetch("/api/registo/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entry_type: type,
          latitude: pos.latitude,
          longitude: pos.longitude,
        }),
      });
      if (!res.ok) throw new Error();
      const dados = (await res.json()) as Desafio;
      setDesafio(dados);
      if (dados.requiresPhoto) {
        setStep("capture");
      } else {
        setCaptureTime(new Date());
        setStep("preview");
      }
    } catch {
      setDesafio(desafioOffline);
      setStep("capture");
    }
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
    if (!position || sending) return;
    const precisaFoto = desafio?.requiresPhoto ?? true;
    if (precisaFoto && !photo) return;

    setSending(true);
    setError(null);
    setLastWasOffline(false);
    const clientTimestamp = new Date().toISOString();

    // Sem rede ou sem desafio válido: fila local (sempre com selfie).
    if (!navigator.onLine || !desafio?.challengeId) {
      const saved = await saveOffline(clientTimestamp);
      setSending(false);
      if (!saved) setError(t.errors.network);
      return;
    }

    // 1. Impressão digital primeiro, quando o telemóvel está registado.
    //    Antes a foto subia à frente e uma digital cancelada deixava-a no
    //    bucket sem registo nenhum — foto guardada por picagem que nunca
    //    existiu, que é o oposto do que o RGPD pede.
    let assertion = null;
    if (desafio.options) {
      try {
        assertion = await startAuthentication({ optionsJSON: desafio.options });
      } catch {
        setError(t.errors.fingerprint);
        setSending(false);
        return;
      }
    }

    // 2. Foto, quando esta picagem a exige.
    let photoPath: string | null = null;
    if (photo) {
      const supabase = createClient();
      photoPath = `${profile.id}/${today}_${entryType}_${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from("selfies")
        .upload(photoPath, photo.blob, { contentType: "image/jpeg" });
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
    }

    // 3. O servidor confere tudo e cria o registo.
    let res: Response;
    try {
      res = await fetch("/api/registo/entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challenge_id: desafio.challengeId,
          entry_type: entryType,
          latitude: position.latitude,
          longitude: position.longitude,
          gps_accuracy: position.accuracy,
          client_timestamp: clientTimestamp,
          photo_path: photoPath,
          assertion,
        }),
      });
    } catch {
      const saved = await saveOffline(clientTimestamp);
      setSending(false);
      if (!saved) setError(t.errors.network);
      return;
    }

    if (!res.ok) {
      const corpo = await res.json().catch(() => ({}));
      setError(
        res.status === 409
          ? t.errors.duplicate
          : (corpo.error ?? t.errors.generic)
      );
      setSending(false);
      return;
    }

    const { entry } = (await res.json()) as { entry: TimeEntry };
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

  // ---------- a preparar (GPS + decisão do servidor) ----------
  if (step === "preparing") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="text-4xl">📍</div>
        <p className="font-semibold text-slate-700">{t.preview.preparing}</p>
        <p className="text-sm text-slate-500">{t.capture.gettingLocation}</p>
        <button
          onClick={() => setStep("home")}
          className="mt-4 rounded-2xl border border-slate-300 bg-white px-6 py-2.5 font-semibold text-slate-600"
        >
          {t.capture.cancel}
        </button>
      </main>
    );
  }

  // ---------- captura ----------
  if (step === "capture") {
    return (
      <CameraCapture
        title={t.capture.titles[entryType]}
        reason={
          desafio?.motivo && desafio.motivo !== "nao_exigida"
            ? (t.capture.reasons as Record<string, string>)[desafio.motivo]
            : undefined
        }
        onCapture={onPhotoCaptured}
        onCancel={() => setStep("home")}
      />
    );
  }

  // ---------- pré-visualização ----------
  if (step === "preview") {
    const lowAccuracy = position !== null && position.accuracy > 100;
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col p-4">
        <h1 className="mb-3 text-center text-lg font-bold">
          {t.preview.title}
        </h1>

        {photo ? (
          <img
            src={photo.dataUrl}
            alt="Selfie"
            className="mb-4 aspect-[3/4] w-full rounded-2xl object-cover shadow-sm"
          />
        ) : desafio && !desafio.requiresPhoto ? (
          <p className="mb-4 rounded-2xl bg-emerald-50 px-4 py-4 text-center text-sm font-medium text-emerald-800">
            👍 {t.preview.noPhotoNeeded}
          </p>
        ) : null}

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
                : geoError
                  ? t.preview.locationUnavailable
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
            <p className="mb-2">
              {geoCausa === "negado"
                ? t.preview.locationDenied
                : t.preview.locationError}
            </p>
            {/* Com a permissão negada, repetir nunca resolve: o browser já
                não volta a perguntar. Mostrar o botão seria mandar a
                pessoa bater na mesma parede outra vez. */}
            {geoCausa !== "negado" && (
              <button
                onClick={requestLocation}
                className="font-semibold underline"
              >
                {t.preview.retryLocation}
              </button>
            )}
          </div>
        )}

        {error && (
          <p className="mb-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        {desafio?.options && (
          <p className="mb-3 rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-600">
            👆 {t.preview.fingerprintNote}
          </p>
        )}

        <div className="mt-auto space-y-3 pb-2">
          <button
            onClick={confirmEntry}
            disabled={!position || sending}
            className="w-full rounded-2xl bg-marca-700 py-4 text-lg font-bold text-white active:bg-marca-800 disabled:opacity-50"
          >
            {sending
              ? t.preview.sending
              : position
                ? t.preview.confirm
                : geoError
                  ? t.preview.noLocation
                  : t.capture.gettingLocation}
          </button>
          <button
            onClick={() => (photo ? setStep("capture") : setStep("home"))}
            disabled={sending}
            className="w-full rounded-2xl border border-slate-300 bg-white py-3.5 font-semibold text-slate-700 active:bg-slate-100"
          >
            {photo ? t.preview.retake : t.capture.cancel}
          </button>
          {/* Sem GPS o botão de confirmar está desativado; sem esta saída
              quem já tirou a selfie só tinha "repetir fotografia" e ficava
              a rodar entre a câmara e este ecrã. */}
          {photo && (
            <button
              onClick={() => setStep("home")}
              disabled={sending}
              className="w-full py-1 text-sm font-semibold text-slate-500 underline"
            >
              {t.capture.cancel}
            </button>
          )}
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
          className="mt-8 w-full rounded-2xl bg-marca-700 py-4 text-lg font-bold text-white active:bg-marca-800"
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

  // Turno aberto = a última picagem foi uma entrada (do dia ou do almoço).
  const doDia = [
    ...entries.map((e) => ({
      entry_type: e.entry_type as string,
      created_at: e.created_at,
    })),
    ...pendingToday.map((p) => ({
      entry_type: p.entry_type as string,
      created_at: p.client_timestamp,
    })),
  ].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const ultima = doDia[doDia.length - 1];
  const turnoAberto =
    ultima &&
    (ultima.entry_type === "entrada" || ultima.entry_type === "volta_almoco")
      ? ultima.created_at
      : null;
  const totalAteAgora = workedSoFar(
    doDia,
    (agora ?? new Date()).toISOString()
  );

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

      {absence && (
        <div className="mb-5 rounded-2xl border border-sky-200 bg-sky-50 p-4">
          <p className="font-semibold text-sky-800">
            🏖️ {t.home.absentToday.replace("{tipo}", t.absences.kinds[absence.kind].toLowerCase())}
            {absence.end_date !== today && (
              <>
                {" "}
                {t.home.absentUntil.replace(
                  "{data}",
                  formatDate(absence.end_date, "pt-PT")
                )}
              </>
            )}
          </p>
          <p className="mt-1 text-sm text-sky-700">{t.home.absentStillPunch}</p>
        </div>
      )}

      {rejectedToday.map((rej, i) => {
        // Só mostra o aviso enquanto o registo não foi refeito.
        if (doneTypes.has(rej.entry_type)) return null;
        return (
          <div
            key={`${rej.entry_type}-${i}`}
            className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4"
          >
            <p className="font-semibold text-red-700">
              ❌ {t.home.rejectedTitle} — {t.types[rej.entry_type]}
            </p>
            {rej.rejection_reason && (
              <p className="mt-1 text-sm text-red-600">
                {t.home.rejectedReason}: {rej.rejection_reason}
              </p>
            )}
            <p className="mt-1 text-sm font-medium text-red-700">
              {t.home.rejectedBody}
            </p>
          </div>
        );
      })}

      {enrollBanner === "ask" && (
        <div className="mb-5 rounded-2xl bg-white p-4 shadow-sm">
          <p className="font-semibold">👆 {t.home.enrollTitle}</p>
          <p className="mb-3 mt-1 text-sm text-slate-500">{t.home.enrollBody}</p>
          <div className="flex gap-2">
            <button
              onClick={registarDispositivo}
              className="flex-1 rounded-xl bg-marca-700 py-2.5 text-sm font-semibold text-white active:bg-marca-800"
            >
              {t.home.enrollButton}
            </button>
            <button
              onClick={() => {
                localStorage.setItem("enroll-dismissed", "1");
                setEnrollBanner("hidden");
              }}
              className="flex-1 rounded-xl border border-slate-300 py-2.5 text-sm font-semibold text-slate-600 active:bg-slate-100"
            >
              {t.home.enrollLater}
            </button>
          </div>
        </div>
      )}
      {enrollBanner === "done" && (
        <p className="mb-5 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
          {t.home.enrollDone}
        </p>
      )}
      {enrollBanner === "error" && (
        <p className="mb-5 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {enrollErro ?? t.home.enrollError}
        </p>
      )}

      {pushBanner === "ask" && (
        <div className="mb-5 rounded-2xl bg-white p-4 shadow-sm">
          <p className="font-semibold">🔔 {t.home.pushTitle}</p>
          <p className="mb-3 mt-1 text-sm text-slate-500">{t.home.pushBody}</p>
          <div className="flex gap-2">
            <button
              onClick={handleEnablePush}
              className="flex-1 rounded-xl bg-marca-700 py-2.5 text-sm font-semibold text-white active:bg-marca-800"
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

      {gpsAviso && (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="font-semibold text-amber-900">
            📍 {t.home.gpsOffTitle}
          </p>
          <p className="mt-1 text-sm text-amber-800">
            {gpsAviso === "negado" ? t.home.gpsDeniedBody : t.home.gpsOffBody}
          </p>
        </div>
      )}

      <section className="mb-4 flex flex-col items-center gap-4 rounded-2xl bg-white p-6 shadow-sm">
        {/* suppressHydrationWarning: a hora do servidor e a do telemóvel
            não são a mesma; o relógio só existe a partir do cliente. */}
        <span
          suppressHydrationWarning
          className="numerico text-5xl font-medium tracking-tight text-slate-900"
        >
          {agora ? formatTime(agora.toISOString()) : "--:--"}
        </span>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            turnoAberto
              ? "bg-emerald-50 text-emerald-700"
              : "bg-slate-100 text-slate-600"
          }`}
        >
          {turnoAberto
            ? t.home.shiftOpen.replace("{hora}", formatTime(turnoAberto))
            : t.home.shiftClosed}
        </span>
        {nextType ? (
          <BigButton
            label={t.home.actions[nextType]}
            emoji={t.home.actionEmojis[nextType]}
            iniciar={nextType === "entrada" || nextType === "volta_almoco"}
            onClick={() => startFlow(nextType)}
          />
        ) : (
          <p className="w-full rounded-xl bg-emerald-50 py-5 text-center text-lg font-bold text-emerald-700">
            {t.home.dayComplete}
          </p>
        )}
        <span className="text-center text-xs text-slate-400">
          {t.home.keepUnlocked}
        </span>
      </section>

      {todayLog.length > 0 && (
        <section className="mb-4 rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-bold text-slate-900">
            {t.home.todayList}
          </h2>
          <ul className="flex flex-col gap-2.5">
            {todayLog.map((row) => (
              <li key={row.key} className="flex items-center justify-between">
                <span className="flex items-center gap-2.5">
                  <span
                    aria-hidden
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                      row.pending
                        ? "bg-amber-500"
                        : row.type === "entrada" || row.type === "volta_almoco"
                          ? "bg-emerald-600"
                          : "bg-red-700"
                    }`}
                  />
                  <span className="text-sm font-semibold text-slate-900">
                    {t.types[row.type]}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {row.flagged && <span title={t.home.flaggedNotice}>⚠️</span>}
                  {row.pending && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                      ⏳ {t.home.pendingBadge}
                    </span>
                  )}
                  <span className="numerico text-sm text-slate-700">
                    {row.time}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-baseline justify-between border-t border-slate-100 pt-3">
            <span className="text-sm text-slate-500">{t.home.totalSoFar}</span>
            <span
              suppressHydrationWarning
              className="numerico text-base font-medium text-slate-900"
            >
              {agora ? formatHoursMinutes(totalAteAgora) : "—"}
            </span>
          </div>
        </section>
      )}

      {pendingToday.length > 0 && (
        <p className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          📡 {t.home.pendingNotice}
        </p>
      )}

      <a
        href="/registo/folha"
        className="mb-6 block rounded-2xl bg-white py-3 text-center text-sm font-semibold text-marca-700 shadow-sm active:bg-slate-50"
      >
        📅 {t.home.monthSheet} →
      </a>
    </main>
  );
}

function BigButton({
  label,
  emoji,
  iniciar = false,
  onClick,
}: {
  label: string;
  emoji: string;
  /** Começar trabalho (entrada/regresso) é laranja; terminar é azul. */
  iniciar?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-xl py-6 text-xl font-semibold text-white ${
        iniciar
          ? "bg-cta active:bg-cta-escuro"
          : "bg-marca-800 active:bg-marca-700"
      }`}
    >
      <span className="mb-1 block text-3xl">{emoji}</span>
      {label}
    </button>
  );
}
