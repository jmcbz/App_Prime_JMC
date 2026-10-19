// Service d'authentification frontend — PRIsME Prime.
const API = '/api/auth';

export type Role = 'admin' | 'prime';

export interface User {
  id: number;
  email: string;
  prenom: string;
  nom: string;
  role: Role;
  is_active: boolean;
}

export type LoginResult =
  | { status: 'authenticated'; user: User }
  | { status: 'mfa_required'; mfaToken: string; user: User }
  | { status: 'mfa_setup_required'; setupToken: string; otpauthUrl: string; qrDataUrl: string; user: User }
  | { status: 'error'; error: string; attemptsRemaining?: number };

async function parseJson(r: Response) {
  const t = await r.text();
  if (!t) return {};
  try { return JSON.parse(t); } catch { return { error: t }; }
}

export async function login(email: string, password: string): Promise<LoginResult> {
  try {
    const r = await fetch(`${API}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });
    const d = await parseJson(r);
    if (!r.ok) return { status: 'error', error: d.error || `Erreur ${r.status}` };
    if (d.mfaSetupRequired && d.setupToken) {
      return { status: 'mfa_setup_required', setupToken: d.setupToken, otpauthUrl: d.otpauthUrl, qrDataUrl: d.qrDataUrl, user: d.user };
    }
    if (d.mfaRequired && d.mfaToken) {
      return { status: 'mfa_required', mfaToken: d.mfaToken, user: d.user };
    }
    if (d.success && d.user) return { status: 'authenticated', user: d.user };
    return { status: 'error', error: d.error || 'Réponse inattendue' };
  } catch (e) {
    return { status: 'error', error: e instanceof Error ? e.message : 'Erreur de connexion' };
  }
}

export async function confirmMfaSetup(setupToken: string, code: string): Promise<LoginResult> {
  return postMfa(`${API}/mfa/setup/confirm`, { setupToken, code });
}

export async function verifyMfaLogin(mfaToken: string, code: string): Promise<LoginResult> {
  return postMfa(`${API}/mfa/login/verify`, { mfaToken, code });
}

async function postMfa(url: string, body: Record<string, string>): Promise<LoginResult> {
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    const d = await parseJson(r);
    if (!r.ok) return { status: 'error', error: d.error || 'Code invalide', attemptsRemaining: d.attemptsRemaining };
    if (d.success && d.user) return { status: 'authenticated', user: d.user };
    return { status: 'error', error: d.error || 'Erreur MFA' };
  } catch (e) {
    return { status: 'error', error: e instanceof Error ? e.message : 'Erreur MFA' };
  }
}

export async function logout(): Promise<void> {
  try { await fetch(`${API}/logout`, { method: 'POST', credentials: 'include' }); } catch { /* ignore */ }
}

export async function checkAuth(): Promise<User | null> {
  try {
    const r = await fetch(`${API}/me`, { credentials: 'include' });
    if (!r.ok) return null;
    const d = await parseJson(r);
    return d.user || null;
  } catch { return null; }
}
