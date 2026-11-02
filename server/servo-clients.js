// Lecture seule des clients actifs de Servo via l'API PRIsME Master.
// Les identifiants OAuth restent exclusivement côté serveur.
export async function loadActiveServoClients({ env = process.env, fetchImpl = fetch } = {}) {
  const base = env.PRISME_MASTER_API_BASE?.trim().replace(/\/+$/, '');
  if (!base || !env.OAUTH_CLIENT_ID || !env.OAUTH_CLIENT_SECRET) {
    throw new Error('Configuration Servo manquante');
  }
  const origin = new URL(base);
  if (origin.protocol !== 'https:') throw new Error('Configuration Servo invalide : HTTPS requis');

  const tokenResponse = await fetchImpl(`${base}/auth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: env.OAUTH_CLIENT_ID, client_secret: env.OAUTH_CLIENT_SECRET }),
    signal: AbortSignal.timeout(12000),
  });
  if (!tokenResponse.ok) throw new Error('Authentification Servo indisponible');
  const token = (await tokenResponse.json())?.access_token;
  if (typeof token !== 'string' || !token) throw new Error('Réponse d’authentification Servo invalide');

  const response = await fetchImpl(`${base}/api/clients`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error('Liste des clients Servo indisponible');
  const payload = await response.json();
  if (!payload || !Array.isArray(payload.data)) throw new Error('Réponse des clients Servo invalide');
  const seen = new Set();
  return payload.data.filter((row) => {
    if (!row || row.active !== 1 || !Number.isSafeInteger(row.id) || row.id <= 0 ||
      typeof row.name !== 'string' || !row.name.trim() || seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  }).map((row) => ({
    id: row.id, nom: row.name.trim(), alias: typeof row.alias === 'string' ? row.alias.trim() : '',
  })).sort((a, b) => a.nom.localeCompare(b.nom, 'fr-CA') || a.id - b.id);
}
