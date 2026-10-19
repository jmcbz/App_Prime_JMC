/**
 * Serveur PRIsME Prime — API auth, MFA TOTP et administration des usagers.
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';

import * as db from './database/index.js';
import * as auth from './auth.js';
import * as mfa from './mfa-service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4100;
const app = express();

app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: process.env.FRONTEND_URL || true,
    credentials: true,
  })
);

// ---------- Auth : login (mot de passe → MFA obligatoire) ----------

async function finalizeLogin(res, user) {
  const token = auth.issueSessionToken(user);
  auth.setSessionCookie(res, token);
  return res.json({ success: true, user: auth.publicUser(user) });
}

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Courriel et mot de passe requis' });

    const user = await db.getUserByEmail(email);
    if (!user || !user.is_active) return res.status(401).json({ error: 'Identifiants invalides' });

    const ok = await auth.verifyPassword(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Identifiants invalides' });

    // MFA obligatoire pour tous : première connexion → setup, ensuite → verify.
    const step = await mfa.resolveMfaLoginStep(user);
    const preview = auth.publicUser(user);

    if (step.step === 'setup') {
      const qrDataUrl = await QRCode.toDataURL(step.otpauthUrl);
      return res.json({
        success: false,
        mfaSetupRequired: true,
        setupToken: step.setupToken,
        otpauthUrl: step.otpauthUrl,
        qrDataUrl,
        user: preview,
        expiresInMinutes: 5,
        maxAttempts: 5,
      });
    }
    return res.json({
      success: false,
      mfaRequired: true,
      mfaToken: step.mfaToken,
      user: preview,
      expiresInMinutes: 5,
      maxAttempts: 5,
    });
  } catch (error) {
    console.error('Erreur login:', error);
    return res.status(500).json({ error: 'Erreur de connexion' });
  }
});

app.post('/api/auth/mfa/setup/confirm', async (req, res) => {
  try {
    const { setupToken, code } = req.body || {};
    if (!setupToken || !code) return res.status(400).json({ error: 'setupToken et code requis' });
    const decoded = mfa.verifyMfaToken(setupToken, 'mfa_setup');
    if (!decoded?.sub) return res.status(401).json({ error: 'Session de configuration MFA invalide ou expirée (5 min)' });
    const user = await db.getUserById(decoded.sub);
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
    await mfa.confirmMfaSetup(user, setupToken, code);
    return finalizeLogin(res, user);
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ error: mfa.toPublicMfaError(error), attemptsRemaining: error.attemptsRemaining });
  }
});

app.post('/api/auth/mfa/login/verify', async (req, res) => {
  try {
    const { mfaToken, code } = req.body || {};
    if (!mfaToken || !code) return res.status(400).json({ error: 'mfaToken et code requis' });
    const decoded = mfa.verifyMfaToken(mfaToken, 'mfa_login');
    if (!decoded?.sub) return res.status(401).json({ error: 'Session MFA invalide ou expirée (5 min)' });
    const user = await db.getUserById(decoded.sub);
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
    await mfa.verifyMfaLogin(user, mfaToken, code);
    return finalizeLogin(res, user);
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ error: mfa.toPublicMfaError(error), attemptsRemaining: error.attemptsRemaining });
  }
});

app.post('/api/auth/logout', (req, res) => {
  auth.clearSessionCookie(res);
  res.json({ success: true });
});

app.get('/api/auth/me', auth.requireAuth, async (req, res) => {
  const user = await db.getUserById(req.auth.sub);
  if (!user || !user.is_active) return res.status(401).json({ error: 'Session invalide' });
  res.json({ user: auth.publicUser(user) });
});

// ---------- Administration des usagers (admin seulement) ----------

app.get('/api/admin/users', auth.requireAuth, auth.requireAdmin, async (_req, res) => {
  const users = await db.listUsers();
  res.json({ users: users.map((u) => ({ ...auth.publicUser(u), mfa_enabled: u.mfa_enabled, mfa_pending: u.mfa_pending })) });
});

app.post('/api/admin/users', auth.requireAuth, auth.requireAdmin, async (req, res) => {
  try {
    const { email, password, prenom, nom, role } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Courriel et mot de passe requis' });
    if (String(password).length < 8) return res.status(400).json({ error: 'Le mot de passe doit faire au moins 8 caractères' });
    if (role && !['admin', 'prime'].includes(role)) return res.status(400).json({ error: 'Rôle invalide' });
    const exists = await db.getUserByEmail(email);
    if (exists) return res.status(409).json({ error: 'Un usager avec ce courriel existe déjà' });
    const passwordHash = await auth.hashPassword(password);
    const user = await db.createUser({ email, passwordHash, prenom, nom, role: role || 'prime' });
    res.status(201).json({ user: auth.publicUser(user) });
  } catch (error) {
    console.error('Erreur création usager:', error);
    res.status(500).json({ error: 'Erreur lors de la création de l’usager' });
  }
});

app.patch('/api/admin/users/:id', auth.requireAuth, auth.requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const target = await db.getUserById(id);
    if (!target) return res.status(404).json({ error: 'Usager introuvable' });
    const { role, is_active } = req.body || {};

    if (role !== undefined) {
      if (!['admin', 'prime'].includes(role)) return res.status(400).json({ error: 'Rôle invalide' });
      // Ne pas rétrograder le dernier admin.
      if (target.role === 'admin' && role !== 'admin' && (await db.countAdmins()) <= 1) {
        return res.status(409).json({ error: 'Impossible de rétrograder le dernier administrateur' });
      }
      await db.updateUserRole(id, role);
    }
    if (is_active !== undefined) {
      if (target.role === 'admin' && is_active === false && (await db.countAdmins()) <= 1) {
        return res.status(409).json({ error: 'Impossible de désactiver le dernier administrateur' });
      }
      await db.setUserActive(id, is_active);
    }
    res.json({ user: auth.publicUser(await db.getUserById(id)) });
  } catch (error) {
    console.error('Erreur mise à jour usager:', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour' });
  }
});

app.post('/api/admin/users/:id/reset-mfa', auth.requireAuth, auth.requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const target = await db.getUserById(id);
    if (!target) return res.status(404).json({ error: 'Usager introuvable' });
    await db.resetMfa(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Erreur reset MFA:', error);
    res.status(500).json({ error: 'Erreur lors de la réinitialisation MFA' });
  }
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// ---------- Service des fichiers statiques (frontend buildé) en production ----------
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '..', 'dist');
  app.use(express.static(distPath));
  app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
}

// ---------- Seed : premier administrateur ----------
async function seedFirstAdmin() {
  const n = await db.countAdmins();
  if (n > 0) return;
  const email = process.env.SEED_ADMIN_EMAIL || 'jean-michel.caouette@bzinc.ca';
  const password = process.env.SEED_ADMIN_PASSWORD || 'ChangeMoi!2026';
  const existing = await db.getUserByEmail(email);
  if (existing) return;
  const passwordHash = await auth.hashPassword(password);
  await db.createUser({ email, passwordHash, prenom: 'Jean-Michel', nom: 'Caouette', role: 'admin' });
  console.log(`🌱 Administrateur initial créé : ${email} (mot de passe par défaut à changer).`);
}

async function start() {
  await db.initDb();
  await seedFirstAdmin();
  app.listen(PORT, () => console.log(`🚀 PRIsME Prime API — port ${PORT}`));
}

start().catch((err) => {
  console.error('Échec du démarrage du serveur:', err);
  process.exit(1);
});

export default app;
