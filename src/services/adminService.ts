// Service d'administration des usagers — PRIsME Prime (admin seulement côté serveur).
import type { Role, User } from './authService';

const API = '/api/admin';

export interface AdminUser extends User {
  mfa_enabled: boolean;
  mfa_pending: boolean;
}

async function parseJson(r: Response) {
  const t = await r.text();
  if (!t) return {};
  try { return JSON.parse(t); } catch { return { error: t }; }
}

export async function listUsers(): Promise<AdminUser[]> {
  const r = await fetch(`${API}/users`, { credentials: 'include' });
  const d = await parseJson(r);
  if (!r.ok) throw new Error(d.error || 'Erreur de chargement');
  return d.users || [];
}

export async function createUser(input: {
  email: string; password: string; prenom: string; nom: string; role: Role;
}): Promise<User> {
  const r = await fetch(`${API}/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  const d = await parseJson(r);
  if (!r.ok) throw new Error(d.error || 'Erreur de création');
  return d.user;
}

export async function updateUser(id: number, patch: { role?: Role; is_active?: boolean }): Promise<User> {
  const r = await fetch(`${API}/users/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(patch),
  });
  const d = await parseJson(r);
  if (!r.ok) throw new Error(d.error || 'Erreur de mise à jour');
  return d.user;
}

export async function resetMfa(id: number): Promise<void> {
  const r = await fetch(`${API}/users/${id}/reset-mfa`, { method: 'POST', credentials: 'include' });
  const d = await parseJson(r);
  if (!r.ok) throw new Error(d.error || 'Erreur de réinitialisation MFA');
}
