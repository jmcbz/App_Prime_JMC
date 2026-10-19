/**
 * Service MFA TOTP — PRIsME Prime.
 * Adapté du pattern éprouvé de la flotte PRIsME BZ (otplib + AES-256-GCM + JWT à usage unique).
 * MFA TOTP obligatoire pour TOUS les usagers (setup au premier login).
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';
import * as db from './database/index.js';

authenticator.options = { window: 1 };

const MFA_ISSUER = process.env.MFA_TOTP_ISSUER || 'PRIsME Prime';
const MFA_TOKEN_EXPIRES = '5m';
const MFA_MAX_ATTEMPTS = 5;
const MFA_ATTEMPT_WINDOW_MS = 5 * 60 * 1000;

const attemptStore = new Map();

function getEncryptionKey() {
  const raw = process.env.MFA_ENCRYPTION_KEY || process.env.JWT_MFA_SECRET || process.env.JWT_SECRET;
  if (!raw) {
    throw new Error('MFA_ENCRYPTION_KEY, JWT_MFA_SECRET ou JWT_SECRET doit être défini pour le MFA');
  }
  return crypto.createHash('sha256').update(String(raw)).digest();
}

export function encryptSecret(plainSecret) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plainSecret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(payload) {
  try {
    const key = getEncryptionKey();
    const parts = String(payload).split(':');
    if (parts.length !== 3) throw new Error('Format secret MFA invalide');
    const [ivB64, tagB64, dataB64] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch (err) {
    const e = new Error('Configuration MFA illisible. Un administrateur peut réinitialiser votre MFA, puis reconfigurez votre application Authenticator.');
    e.code = 'MFA_DECRYPT_FAILED';
    e.statusCode = 409;
    e.cause = err;
    throw e;
  }
}

function canDecryptSecret(payload) {
  if (!payload) return false;
  try {
    decryptSecret(payload);
    return true;
  } catch (err) {
    if (err.code === 'MFA_DECRYPT_FAILED') return false;
    throw err;
  }
}

function getJwtSecret() {
  return process.env.JWT_SECRET || 'app-prime-dev-secret-change-in-production';
}

export function issueMfaToken(user, purpose) {
  return jwt.sign({ sub: user.id, email: user.email, purpose }, getJwtSecret(), { expiresIn: MFA_TOKEN_EXPIRES });
}

export function verifyMfaToken(token, expectedPurpose) {
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    if (decoded.purpose !== expectedPurpose) return null;
    return decoded;
  } catch {
    return null;
  }
}

function checkRateLimit(email) {
  const key = (email || '').toLowerCase();
  const now = Date.now();
  let entry = attemptStore.get(key);
  if (!entry || now > entry.resetAt) entry = { count: 0, resetAt: now + MFA_ATTEMPT_WINDOW_MS };
  if (entry.count >= MFA_MAX_ATTEMPTS) {
    const err = new Error(`Trop de tentatives MFA (${MFA_MAX_ATTEMPTS} essais). Réessayez dans 5 minutes.`);
    err.statusCode = 429;
    throw err;
  }
  entry.count += 1;
  attemptStore.set(key, entry);
}

export function getMfaAttemptInfo(email) {
  const key = (email || '').toLowerCase();
  const entry = attemptStore.get(key);
  if (!entry || Date.now() > entry.resetAt) {
    return { attemptsUsed: 0, attemptsRemaining: MFA_MAX_ATTEMPTS, locked: false };
  }
  return {
    attemptsUsed: entry.count,
    attemptsRemaining: Math.max(0, MFA_MAX_ATTEMPTS - entry.count),
    locked: entry.count >= MFA_MAX_ATTEMPTS,
  };
}

export function clearRateLimit(email) {
  attemptStore.delete((email || '').toLowerCase());
}

/** MFA TOTP obligatoire pour tout usager actif. */
export function isMfaRequiredForUser(user) {
  return !!user && user.is_active === true;
}

export async function getMfaStatusForUser(userId) {
  const row = await db.getMfaByUserId(userId);
  if (!row) return { enrolled: false, enabled: false, pendingSetup: false };
  return { enrolled: true, enabled: row.mfa_enabled === true, pendingSetup: row.pending_setup === true, enabledAt: row.enabled_at };
}

export async function beginMfaSetup(user) {
  const secret = authenticator.generateSecret();
  await db.upsertMfaPending(user.id, encryptSecret(secret));
  const otpauthUrl = authenticator.keyuri(user.email, MFA_ISSUER, secret);
  return { setupToken: issueMfaToken(user, 'mfa_setup'), otpauthUrl };
}

/** Détermine l'étape MFA au login : 'setup' (premier login) ou 'verify'. */
export async function resolveMfaLoginStep(user) {
  const status = await getMfaStatusForUser(user.id);
  if (!status.enabled) return { step: 'setup', ...(await beginMfaSetup(user)) };
  const row = await db.getMfaByUserId(user.id);
  if (!canDecryptSecret(row?.secret_encrypted)) {
    console.warn(`⚠️ MFA: secret illisible pour ${user.email} — re-enrôlement forcé.`);
    return { step: 'setup', ...(await beginMfaSetup(user)) };
  }
  return { step: 'verify', mfaToken: issueMfaToken(user, 'mfa_login') };
}

export async function confirmMfaSetup(user, setupToken, code) {
  const decoded = verifyMfaToken(setupToken, 'mfa_setup');
  if (!decoded || decoded.sub !== user.id) {
    const err = new Error('Session de configuration MFA invalide ou expirée');
    err.statusCode = 401;
    throw err;
  }
  checkRateLimit(user.email);
  const row = await db.getMfaByUserId(user.id);
  if (!row) {
    const err = new Error('Configuration MFA introuvable');
    err.statusCode = 400;
    throw err;
  }
  const secret = decryptSecret(row.secret_encrypted);
  if (!authenticator.verify({ token: String(code).replace(/\s/g, ''), secret })) {
    const err = new Error('Code MFA invalide');
    err.statusCode = 401;
    err.attemptsRemaining = getMfaAttemptInfo(user.email).attemptsRemaining;
    throw err;
  }
  await db.enableMfa(user.id);
  clearRateLimit(user.email);
  return true;
}

export async function verifyMfaLogin(user, mfaToken, code) {
  const decoded = verifyMfaToken(mfaToken, 'mfa_login');
  if (!decoded || decoded.sub !== user.id) {
    const err = new Error('Session MFA invalide ou expirée');
    err.statusCode = 401;
    throw err;
  }
  checkRateLimit(user.email);
  const row = await db.getMfaByUserId(user.id);
  if (!row?.mfa_enabled) {
    const err = new Error('MFA non activé pour ce compte');
    err.statusCode = 400;
    throw err;
  }
  const secret = decryptSecret(row.secret_encrypted);
  if (!authenticator.verify({ token: String(code).replace(/\s/g, ''), secret })) {
    const err = new Error('Code MFA invalide');
    err.statusCode = 401;
    err.attemptsRemaining = getMfaAttemptInfo(user.email).attemptsRemaining;
    throw err;
  }
  clearRateLimit(user.email);
  return true;
}

export function toPublicMfaError(error) {
  if (error?.code === 'MFA_DECRYPT_FAILED' || (error?.statusCode && error.statusCode < 500)) {
    return error.message;
  }
  return process.env.NODE_ENV === 'development' ? String(error?.message || 'Erreur MFA') : 'Erreur MFA. Réessayez ou contactez un administrateur.';
}
