"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getDictionary } from "@/lib/i18n";
import { loginToEmail } from "@/lib/username";

const t = getDictionary("fr");

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      // username → email interno; um email completo passa tal e qual
      email: loginToEmail(email),
      password,
    });
    if (error) {
      setError(t.login.error);
      setLoading(false);
      return;
    }
    // Navegação completa para o middleware/servidor lerem os novos cookies.
    window.location.assign("/");
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-700 text-3xl">
            📍
          </div>
          <h1 className="text-2xl font-bold">{t.login.title}</h1>
          <p className="mt-1 text-sm text-slate-500">{t.login.subtitle}</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl bg-white p-6 shadow-sm"
        >
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="email">
              {t.login.email}
            </label>
            <input
              id="email"
              type="text"
              required
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={t.login.emailHint}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none placeholder:text-slate-300 focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20"
            />
          </div>
          <div>
            <label
              className="mb-1 block text-sm font-medium"
              htmlFor="password"
            >
              {t.login.password}
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20"
            />
          </div>

          {error && (
            <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-teal-700 py-3.5 text-base font-semibold text-white active:bg-teal-800 disabled:opacity-60"
          >
            {loading ? t.login.loading : t.login.submit}
          </button>
        </form>
      </div>
    </main>
  );
}
