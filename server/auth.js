/**
 * Authentification PRIsME Prime — bcrypt + JWT de session (cookie httpOnly).
 * 2 rôles : 'admin' (gère tout) et 'prime' (usager standard).
 */
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { getUserById, getMfaByUserId } from './database/index.js';

const SESSION_EXPIRES = '12h';
const COOKIE_NAME = 'app_prime_session';

function getJwtSecret() {
  return process.env.JWT_SECRET || 'app-prime-dev-secret-change-in-production';
}

export async function hashPassword(plain) {
  return bcrypt.hash(String(plain), 10);
}

export async function verifyPassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compare(String(plain), hash);
}

/** Vue publique d'un usager (jamais le hash de mot de passe ni le secret MFA). */
export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    prenom: user.prenom,
    nom: user.nom,
    role: user.role,
    is_active: user.is_active,
  };
}

function mfaVersion(mfa) {
  if (!mfa?.mfa_enabled || !mfa.secret_encrypted) return null;
  return crypto.createHmac('sha256', getJwtSecret()).update(mfa.secret_encrypted).digest('hex');
}

export function issueSessionToken(user, mfa) {
  const version = mfaVersion(mfa);
  if (!version) throw new Error('MFA confirmé requis pour créer une session');
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, purpose: 'session', mfaVersion: version },
    getJwtSecret(),
    { expiresIn: SESSION_EXPIRES }
  );
}

export function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 12 * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

function readToken(req) {
  const fromCookie = req.cookies?.[COOKIE_NAME];
  if (fromCookie) return fromCookie;
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

/** Middleware : vérifie le jeton puis le rôle et l'état actuels en base. */
export async function requireAuth(req, res, next) {
  const token = readToken(req);
  if (!token) return res.status(401).json({ error: 'Non authentifié' });
  let decoded;
  try {
    decoded = jwt.verify(token, getJwtSecret());
    if (decoded.purpose !== 'session') return res.status(401).json({ error: 'Session invalide' });
  } catch {
    return res.status(401).json({ error: 'Session invalide ou expirée' });
  }
  let user, mfa;
  try {
    user = await getUserById(decoded.sub);
    if (user?.is_active) mfa = await getMfaByUserId(user.id);
  } catch (error) {
    console.error('Vérification de session impossible:', error);
    return res.status(503).json({ error: 'Vérification de session indisponible' });
  }
  const currentVersion = mfaVersion(mfa);
  if (!user || !user.is_active || !currentVersion || decoded.mfaVersion !== currentVersion) {
    return res.status(401).json({ error: 'Session invalide' });
  }
  req.auth = { ...decoded, sub: user.id, email: user.email, role: user.role };
  next();
}

/** Middleware : exige le rôle admin (à chaîner après requireAuth). */
export function requireAdmin(req, res, next) {
  if (req.auth?.role !== 'admin') return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
  next();
}

export { COOKIE_NAME };
