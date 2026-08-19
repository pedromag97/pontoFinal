"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

// Substitui os confirm/prompt/alert do browser por janelas no estilo da app.
// A API é imperativa e devolve promessas, para os componentes ficarem tão
// simples como estavam: `if (!(await confirm({...}))) return;`

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface PromptOptions extends ConfirmOptions {
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  type?: "text" | "time" | "password" | "number";
  required?: boolean;
}

interface AlertOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
}

interface DialogApi {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
  alert: (options: AlertOptions) => Promise<void>;
}

type Estado =
  | ({ kind: "confirm" } & ConfirmOptions)
  | ({ kind: "prompt" } & PromptOptions)
  | ({ kind: "alert" } & AlertOptions);

const DialogContext = createContext<DialogApi | null>(null);

export function useDialogs(): DialogApi {
  const api = useContext(DialogContext);
  if (!api) throw new Error("useDialogs precisa do DialogProvider");
  return api;
}

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [valor, setValor] = useState("");
  const resolver = useRef<((resultado: unknown) => void) | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const abrir = useCallback((novo: Estado, inicial = "") => {
    setValor(inicial);
    setEstado(novo);
    return new Promise<unknown>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const fechar = useCallback((resultado: unknown) => {
    setEstado(null);
    resolver.current?.(resultado);
    resolver.current = null;
  }, []);

  const api: DialogApi = {
    confirm: (options) =>
      abrir({ kind: "confirm", ...options }) as Promise<boolean>,
    prompt: (options) =>
      abrir({ kind: "prompt", ...options }, options.defaultValue ?? "") as Promise<
        string | null
      >,
    alert: (options) => abrir({ kind: "alert", ...options }) as Promise<void>,
  };

  // Escape fecha; ao abrir, o foco vai para o campo (ou fica no botão).
  useEffect(() => {
    if (!estado) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") fechar(estado?.kind === "prompt" ? null : false);
    }
    document.addEventListener("keydown", onKey);
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => {
      document.removeEventListener("keydown", onKey);
      clearTimeout(timer);
    };
  }, [estado, fechar]);

  function submeter(e: React.FormEvent) {
    e.preventDefault();
    if (!estado) return;
    if (estado.kind === "prompt") {
      const limpo = valor.trim();
      if (estado.required !== false && !limpo) return; // não fecha sem valor
      fechar(limpo);
    } else {
      fechar(estado.kind === "confirm" ? true : undefined);
    }
  }

  const perigo = estado?.kind !== "alert" && estado?.danger;

  return (
    <DialogContext.Provider value={api}>
      {children}
      {estado && (
        <div
          className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]"
          onMouseDown={(e) => {
            // clicar fora cancela
            if (e.target === e.currentTarget) {
              fechar(estado.kind === "prompt" ? null : false);
            }
          }}
        >
          <form
            onSubmit={submeter}
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
            role="dialog"
            aria-modal="true"
          >
            <h2 className="text-lg font-bold text-slate-900">{estado.title}</h2>
            {estado.message && (
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                {estado.message}
              </p>
            )}

            {estado.kind === "prompt" && (
              <div className="mt-4">
                {estado.label && (
                  <label className="mb-1 block text-xs font-medium text-slate-500">
                    {estado.label}
                  </label>
                )}
                <input
                  ref={inputRef}
                  type={estado.type ?? "text"}
                  value={valor}
                  placeholder={estado.placeholder}
                  onChange={(e) => setValor(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-marca-600 focus:ring-2 focus:ring-marca-600/20"
                />
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              {estado.kind !== "alert" && (
                <button
                  type="button"
                  onClick={() =>
                    fechar(estado.kind === "prompt" ? null : false)
                  }
                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                >
                  {estado.cancelLabel ?? "Cancelar"}
                </button>
              )}
              <button
                type="submit"
                className={`rounded-xl px-4 py-2 text-sm font-semibold text-white ${
                  perigo
                    ? "bg-red-600 hover:bg-red-700"
                    : "bg-marca-700 hover:bg-marca-800"
                }`}
              >
                {estado.confirmLabel ?? "Confirmar"}
              </button>
            </div>
          </form>
        </div>
      )}
    </DialogContext.Provider>
  );
}
