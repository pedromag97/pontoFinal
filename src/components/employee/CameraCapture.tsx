"use client";

import { useEffect, useRef, useState } from "react";
import { getDictionary } from "@/lib/i18n";

const t = getDictionary("pt");

// Captura direta pela câmara frontal via getUserMedia. Se o browser recusar
// (permissão negada / hardware), cai para <input capture="user">.
// Limitação documentada: numa PWA não é possível garantir a 100% que o
// fallback não deixa escolher uma foto da galeria em todos os dispositivos.
export default function CameraCapture({
  title,
  onCapture,
  onCancel,
}: {
  title: string;
  onCapture: (blob: Blob, dataUrl: string) => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraFailed, setCameraFailed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 1280 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setReady(true);
        }
      } catch {
        if (!cancelled) setCameraFailed(true);
      }
    }

    start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function stopStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  function takePhoto() {
    const video = videoRef.current;
    if (!video || !ready) return;

    // Reduz para máx. 1080px de largura — suficiente como prova, upload leve.
    const scale = Math.min(1, 1080 / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        stopStream();
        onCapture(blob, canvas.toDataURL("image/jpeg", 0.85));
      },
      "image/jpeg",
      0.85
    );
  }

  function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      onCapture(file, reader.result as string);
    };
    reader.readAsDataURL(file);
  }

  function handleCancel() {
    stopStream();
    onCancel();
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col p-4">
      <h1 className="mb-3 text-center text-lg font-bold">{title}</h1>

      {!cameraFailed ? (
        <>
          <div className="relative mb-4 aspect-[3/4] w-full overflow-hidden rounded-2xl bg-slate-900">
            {/* espelhado só na pré-visualização; a foto gravada não é espelhada */}
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className="h-full w-full -scale-x-100 object-cover"
            />
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center text-white/70">
                ⏳
              </div>
            )}
          </div>
          <p className="mb-4 text-center text-sm text-slate-500">
            {t.capture.instructions}
          </p>
          <div className="mt-auto space-y-3 pb-2">
            <button
              onClick={takePhoto}
              disabled={!ready}
              className="w-full rounded-2xl bg-marca-700 py-4 text-lg font-bold text-white active:bg-marca-800 disabled:opacity-50"
            >
              📸 {t.capture.take}
            </button>
            <button
              onClick={handleCancel}
              className="w-full rounded-2xl border border-slate-300 bg-white py-3.5 font-semibold text-slate-700 active:bg-slate-100"
            >
              {t.capture.cancel}
            </button>
          </div>
        </>
      ) : (
        <div className="flex flex-1 flex-col justify-center pb-10">
          <p className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-center text-sm text-amber-800">
            {t.capture.cameraError}
          </p>
          <label className="block w-full cursor-pointer rounded-2xl bg-marca-700 py-4 text-center text-lg font-bold text-white active:bg-marca-800">
            📸 {t.capture.fallbackButton}
            <input
              type="file"
              accept="image/*"
              capture="user"
              onChange={onFileSelected}
              className="hidden"
            />
          </label>
          <button
            onClick={handleCancel}
            className="mt-3 w-full rounded-2xl border border-slate-300 bg-white py-3.5 font-semibold text-slate-700 active:bg-slate-100"
          >
            {t.capture.cancel}
          </button>
        </div>
      )}
    </main>
  );
}
