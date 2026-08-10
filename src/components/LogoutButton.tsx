"use client";

import { createClient } from "@/lib/supabase/client";

export default function LogoutButton({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.assign("/login");
  }

  return (
    <button
      onClick={handleLogout}
      className={
        className ??
        "rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 active:bg-slate-100"
      }
    >
      {label}
    </button>
  );
}
