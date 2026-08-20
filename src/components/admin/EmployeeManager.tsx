"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getDictionary } from "@/lib/i18n";
import { useDialogs } from "@/components/ui/Dialogs";
import { formatDateShort } from "@/lib/format";
import type { Profile, Worksite } from "@/types";
import WorksiteAssignment from "@/components/admin/WorksiteAssignment";

const t = getDictionary("pt");

export default function EmployeeManager({
  initialProfiles,
  worksites,
  assignedByEmployee,
  devicesByEmployee,
  syncedByEmployee,
}: {
  initialProfiles: Profile[];
  worksites: Worksite[];
  assignedByEmployee: Record<string, string[]>;
  devicesByEmployee: Record<string, number>;
  syncedByEmployee: Record<string, boolean>;
}) {
  const router = useRouter();
  const dialogs = useDialogs();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"employee" | "admin">("employee");
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  );
  const [busyId, setBusyId] = useState<string | null>(null);

  async function createEmployee(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setMessage(null);
    const res = await fetch("/api/admin/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        full_name: name.trim(),
        login: email.trim(),
        password,
        role,
      }),
    });
    setCreating(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setMessage({ ok: false, text: body.error ?? t.employees.error });
      return;
    }
    setMessage({ ok: true, text: t.employees.created });
    setName("");
    setEmail("");
    setPassword("");
    setRole("employee");
    router.refresh();
  }

  async function patchEmployee(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    setMessage(null);
    const res = await fetch(`/api/admin/employees/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusyId(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setMessage({ ok: false, text: body.error ?? t.employees.error });
      return false;
    }
    router.refresh();
    return true;
  }

  async function eraseData(profile: Profile) {
    const ok = await dialogs.confirm({
      title: t.employees.eraseData,
      message: `${profile.full_name} — ${t.employees.eraseConfirm}`,
      confirmLabel: t.employees.eraseData,
      danger: true,
    });
    if (!ok) return;
    const deleteAccount = await dialogs.confirm({
      title: t.employees.eraseAccountTitle,
      message: t.employees.eraseAccountAlso,
      confirmLabel: t.employees.eraseAccountYes,
      cancelLabel: t.employees.eraseAccountNo,
      danger: true,
    });
    setBusyId(profile.id);
    setMessage(null);
    const res = await fetch(`/api/admin/employees/${profile.id}/erase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deleteAccount }),
    });
    setBusyId(null);
    if (!res.ok) {
      setMessage({ ok: false, text: t.employees.error });
      return;
    }
    setMessage({ ok: true, text: t.employees.eraseDone });
    router.refresh();
  }

  // Troca de telemóvel: remover o registado obriga o funcionário a
  // registar o novo (e, até lá, os registos voltam a exigir selfie).
  async function removerDispositivo(profile: Profile) {
    const ok = await dialogs.confirm({
      title: `${t.employees.deviceReset} — ${profile.full_name}`,
      message: t.employees.deviceResetConfirm,
      confirmLabel: t.employees.deviceReset,
      danger: true,
    });
    if (!ok) return;
    setBusyId(profile.id);
    const supabase = createClient();
    const { error } = await supabase
      .from("webauthn_credentials")
      .delete()
      .eq("employee_id", profile.id);
    setBusyId(null);
    if (error) {
      setMessage({ ok: false, text: t.employees.error });
      return;
    }
    router.refresh();
  }

  async function rename(profile: Profile) {
    const newName = await dialogs.prompt({
      title: t.employees.rename,
      label: t.employees.name,
      defaultValue: profile.full_name,
      confirmLabel: t.worksites.save,
    });
    if (!newName?.trim()) return;
    await patchEmployee(profile.id, { full_name: newName.trim() });
  }

  async function resetPassword(profile: Profile) {
    const newPassword = await dialogs.prompt({
      title: t.employees.resetPassword,
      message: `${profile.full_name}`,
      label: t.employees.resetPrompt,
      type: "text",
      confirmLabel: t.worksites.save,
    });
    if (!newPassword) return;
    const ok = await patchEmployee(profile.id, { password: newPassword });
    if (ok) setMessage({ ok: true, text: t.employees.resetDone });
  }

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">{t.employees.title}</h1>

      <form
        onSubmit={createEmployee}
        className="mb-6 rounded-2xl bg-white p-5 shadow-sm"
      >
        <h2 className="mb-3 font-semibold">➕ {t.employees.newTitle}</h2>
        <div className="flex flex-wrap gap-3">
          <input
            required
            placeholder={t.employees.name}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="min-w-52 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            required
            type="text"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={t.employees.email}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="min-w-52 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            required
            type="text"
            minLength={8}
            placeholder={t.employees.password}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="min-w-44 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "employee" | "admin")}
            aria-label={t.employees.roleLabel}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="employee">{t.employees.role_employee}</option>
            <option value="admin">{t.employees.role_admin}</option>
          </select>
          <button
            type="submit"
            disabled={creating}
            className="rounded-lg bg-marca-700 px-5 py-2 text-sm font-semibold text-white hover:bg-marca-800 disabled:opacity-60"
          >
            {creating ? t.employees.creating : t.employees.create}
          </button>
        </div>
        {role === "admin" && (
          <p className="mt-2 text-xs text-amber-700">{t.employees.adminHint}</p>
        )}
      </form>

      {message && (
        <p
          className={`mb-4 rounded-xl px-4 py-3 text-sm ${
            message.ok
              ? "bg-emerald-50 text-emerald-700"
              : "bg-red-50 text-red-700"
          }`}
        >
          {message.text}
        </p>
      )}

      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3">{t.employees.name}</th>
              <th className="px-4 py-3">{t.employees.loginCol}</th>
              <th className="px-4 py-3">{t.employees.worksites}</th>
              <th className="px-4 py-3">{t.employees.device}</th>
              <th className="px-4 py-3">{t.employees.consent}</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {initialProfiles.map((profile) => (
              <tr
                key={profile.id}
                className={`border-b border-slate-100 last:border-0 ${!profile.active ? "opacity-50" : ""}`}
              >
                <td className="px-4 py-3">
                  <span className="font-medium">{profile.full_name || "—"}</span>
                  <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                    {profile.role === "admin"
                      ? t.employees.role_admin
                      : t.employees.role_employee}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-600">
                  {profile.username ?? "—"}
                </td>
                <td className="px-4 py-3">
                  {profile.role === "employee" ? (
                    <WorksiteAssignment
                      employeeId={profile.id}
                      employeeName={profile.full_name}
                      worksites={worksites}
                      assigned={assignedByEmployee[profile.id] ?? []}
                    />
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {profile.role !== "employee" ? (
                    <span className="text-slate-300">—</span>
                  ) : (devicesByEmployee[profile.id] ?? 0) > 0 ? (
                    <>
                      <button
                        onClick={() => removerDispositivo(profile)}
                        disabled={busyId === profile.id}
                        title={t.employees.deviceReset}
                        className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-200 disabled:opacity-50"
                      >
                        👆 {t.employees.deviceYes}
                      </button>
                      {syncedByEmployee[profile.id] && (
                        <span
                          title={t.employees.deviceSyncedHint}
                          className="ml-1 cursor-help rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800"
                        >
                          ☁️
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-500">
                      {t.employees.deviceNo}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {profile.consent_given_at
                    ? `${t.employees.consentYes} ${formatDateShort(profile.consent_given_at.slice(0, 10))}`
                    : t.employees.consentNo}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      profile.active
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-slate-200 text-slate-600"
                    }`}
                  >
                    {profile.active ? t.employees.active : t.employees.inactive}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  {(
                    <div className="flex flex-wrap justify-end gap-2">
                      <ActionButton
                        onClick={() => rename(profile)}
                        disabled={busyId === profile.id}
                      >
                        {t.employees.rename}
                      </ActionButton>
                      <ActionButton
                        onClick={() => resetPassword(profile)}
                        disabled={busyId === profile.id}
                      >
                        {t.employees.resetPassword}
                      </ActionButton>
                      <ActionButton
                        onClick={() =>
                          patchEmployee(profile.id, { active: !profile.active })
                        }
                        disabled={busyId === profile.id}
                      >
                        {profile.active
                          ? t.employees.deactivate
                          : t.employees.activate}
                      </ActionButton>
                      <ActionButton
                        onClick={async () => {
                          const toAdmin = profile.role === "employee";
                          const confirmText = toAdmin
                            ? t.employees.makeAdminConfirm
                            : t.employees.makeEmployeeConfirm;
                          const okRole = await dialogs.confirm({
                            title: toAdmin
                              ? t.employees.makeAdmin
                              : t.employees.makeEmployee,
                            message: confirmText,
                            confirmLabel: t.worksites.save,
                          });
                          if (!okRole) return;
                          const ok = await patchEmployee(profile.id, {
                            role: toAdmin ? "admin" : "employee",
                          });
                          if (ok)
                            setMessage({
                              ok: true,
                              text: t.employees.roleChanged,
                            });
                        }}
                        disabled={busyId === profile.id}
                      >
                        {profile.role === "employee"
                          ? t.employees.makeAdmin
                          : t.employees.makeEmployee}
                      </ActionButton>
                      <ActionButton
                        onClick={() => eraseData(profile)}
                        disabled={busyId === profile.id}
                        danger
                      >
                        {t.employees.eraseData}
                      </ActionButton>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${
        danger
          ? "border-red-200 text-red-600 hover:bg-red-50"
          : "border-slate-300 text-slate-600 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}
