// Login por username: o Supabase Auth exige email, por isso cada username
// é mapeado para um email interno "<username>@ponto.lusocabo.com" que nunca
// recebe correio (contas criadas pela gestão, confirmação de email desativada).
// Se o input já contiver "@", é tratado como email real (caso dos admins).
export const LOGIN_EMAIL_DOMAIN = "ponto.lusocabo.com";

// 3–30 caracteres: letras minúsculas, números, ponto, hífen, underscore.
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;

export function normalizeLogin(input: string): string {
  return input.trim().toLowerCase();
}

export function loginToEmail(input: string): string {
  const value = normalizeLogin(input);
  return value.includes("@") ? value : `${value}@${LOGIN_EMAIL_DOMAIN}`;
}
