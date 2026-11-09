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
import { loadActiveServoClients } from './servo-clients.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4100;
const app = express();

// A populated 11-section checklist can exceed Express's 100kb default.
app.use(express.json({limit:'2mb'}));
app.use((error,req,res,next)=>{
  if(error?.type==='entity.too.large') return res.status(413).json({error:'Corps de requête trop volumineux (maximum 2 Mo)'});
  next(error);
});
app.use(cookieParser());
// Cookies use SameSite=Lax, which does not isolate sibling subdomains.
// Compare full origins, not sites; never reflect arbitrary credentialed CORS.
function trustedOrigin(req, origin) {
  if (!origin) return false;
  try {
    if (new URL(origin).origin !== origin) return false;
    const frontend = process.env.FRONTEND_URL;
    if (frontend && new URL(frontend).origin === origin) return true;
    const protocol = req.get('x-forwarded-proto')?.split(',')[0].trim() || req.protocol;
    return origin === `${protocol}://${req.get('host')}`;
  } catch {
    return false;
  }
}
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.cookies?.[auth.COOKIE_NAME] && req.get('origin') && !trustedOrigin(req, req.get('origin'))) {
    return res.status(403).json({ error: 'Origine non autorisée' });
  }
  next();
});
app.use(cors((req, callback) => {
  const origin = req.get('origin');
  callback(null, { origin: trustedOrigin(req, origin) ? origin : false, credentials: true });
}));

// ---------- Auth : login (mot de passe → MFA obligatoire) ----------

async function finalizeLogin(res, user) {
  const mfaState = await db.getMfaByUserId(user.id);
  const token = auth.issueSessionToken(user, mfaState);
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
  res.json({ users: users.map((u) => ({ ...auth.publicUser(u), primeId: u.primeId, primeNom: u.primeNom, mfa_enabled: u.mfa_enabled, mfa_pending: u.mfa_pending })) });
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
    const created = await db.createUserWithPrime({ email, passwordHash, prenom, nom, role: role || 'prime' });
    res.status(201).json({ user: auth.publicUser(created.user), prime: created.prime });
  } catch (error) {
    console.error('Erreur création usager:', error);
    res.status(500).json({ error: 'Erreur lors de la création de l’usager' });
  }
});

app.post('/api/admin/users/:id/prime', auth.requireAuth, auth.requireAdmin, async (req, res) => {
  try {
    const prime = await db.linkExistingUserToPrime(Number(req.params.id), req.body?.primeId);
    res.json({ prime });
  } catch (error) {
    if ([400, 404, 409].includes(error?.statusCode)) return res.status(error.statusCode).json({ error: error.message });
    console.error('Erreur association du Prime:', error);
    res.status(500).json({ error: 'Erreur lors de l’association du Prime' });
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

// L'API Servo est consultée en lecture seule côté serveur : jamais de jeton OAuth dans le navigateur.
app.get('/api/servo/clients', auth.requireAuth, auth.requireAdmin, async (_req, res) => {
  try { res.json({ clients: await loadActiveServoClients() }); }
  catch (error) {
    console.error('Lecture des clients Servo impossible:', error instanceof Error ? error.message : error);
    res.status(error?.message === 'Configuration Servo manquante' ? 503 : 502)
      .json({ error: 'Liste des clients Servo indisponible. Réessayez plus tard.' });
  }
});

// ---------- Données métier : Primes / Clients / Suivis ----------
// Lecture : tout usager authentifié. Écriture : admin seulement.

function handleError(res, error, msg) {
  console.error(msg, error);
  res.status(500).json({ error: msg });
}

// Primes
app.get('/api/primes', auth.requireAuth, async (req, res) => {
  try { res.json({ primes: req.auth.role === 'admin' ? await db.listPrimes() : await db.listPrimesForUser(req.auth.sub) }); }
  catch (e) { handleError(res, e, 'Erreur chargement des Primes'); }
});
app.post('/api/primes', auth.requireAuth, auth.requireAdmin, async (req, res) => {
  try {
    const { nom } = req.body || {};
    if (!nom) return res.status(400).json({ error: 'Le nom est requis' });
    res.status(201).json({ prime: await db.createPrime(req.body) });
  } catch (e) { handleError(res, e, 'Erreur création Prime'); }
});
app.put('/api/primes/:id', auth.requireAuth, auth.requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const prime = await db.updatePrime(id, req.body || {});
    if (!prime) return res.status(404).json({ error: 'Prime introuvable' });
    res.json({ prime });
  } catch (e) { handleError(res, e, 'Erreur mise à jour Prime'); }
});
app.put('/api/primes/:id/portfolio', auth.requireAuth, auth.requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { prime, addServoIds = [], removeClientIds = [] } = req.body || {};
    if (!Number.isSafeInteger(id) || id <= 0 || !Array.isArray(addServoIds) || !Array.isArray(removeClientIds) ||
      addServoIds.some((value) => !Number.isSafeInteger(value) || value <= 0) ||
      new Set(addServoIds).size !== addServoIds.length) {
      return res.status(400).json({ error: 'Sélection de clients invalide' });
    }
    const catalog = addServoIds.length ? await loadActiveServoClients() : [];
    const remote = new Map(catalog.map((client) => [client.id, client]));
    if (addServoIds.some((clientId) => !remote.has(clientId))) {
      return res.status(409).json({ error: 'Un client sélectionné n’est plus actif dans Servo. Rechargez la liste.' });
    }
    const result = await db.updatePrimePortfolio(id, prime, {
      add: addServoIds.map((clientId) => remote.get(clientId)), remove: removeClientIds,
      catalog,
    });
    if (!result) return res.status(404).json({ error: 'Prime introuvable' });
    res.json(result);
  } catch (error) {
    if (error?.statusCode === 400 || error?.statusCode === 409) return res.status(error.statusCode).json({ error: error.message });
    handleError(res, error, 'Erreur de mise à jour du portefeuille Prime');
  }
});
app.delete('/api/primes/:id', auth.requireAuth, auth.requireAdmin, async (req, res) => {
  try { await db.deletePrime(parseInt(req.params.id, 10)); res.json({ success: true }); }
  catch (e) {
    if (e?.statusCode === 409) return res.status(409).json({ error: e.message });
    handleError(res, e, 'Erreur suppression Prime');
  }
});

// Clients
app.get('/api/clients', auth.requireAuth, async (req, res) => {
  try { res.json({ clients: req.auth.role === 'admin' ? await db.listClients() : await db.listClientsForUser(req.auth.sub) }); }
  catch (e) { handleError(res, e, 'Erreur chargement des clients'); }
});
app.post('/api/clients', auth.requireAuth, auth.requireAdmin, async (req, res) => {
  try {
    const { nom } = req.body || {};
    if (!nom) return res.status(400).json({ error: 'Le nom est requis' });
    // Seule la route portefeuille peut lier un client à l'ID officiel Servo.
    res.status(201).json({ client: await db.createClient({ ...req.body, servoClientId: undefined }) });
  } catch (e) {
    if (e?.statusCode === 400) return res.status(400).json({ error: e.message });
    handleError(res, e, 'Erreur création client');
  }
});
app.put('/api/clients/:id', auth.requireAuth, auth.requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { client: changes, expected } = req.body || {};
    const client = await db.updateClient(id, changes || {}, expected);
    if (!client) return res.status(404).json({ error: 'Client introuvable' });
    res.json({ client });
  } catch (e) {
    if (e?.statusCode === 400 || e?.statusCode === 409) return res.status(e.statusCode).json({ error: e.message });
    handleError(res, e, 'Erreur mise à jour client');
  }
});
app.delete('/api/clients/:id', auth.requireAuth, auth.requireAdmin, async (req, res) => {
  try { await db.deleteClient(parseInt(req.params.id, 10)); res.json({ success: true }); }
  catch (e) {
    if (e?.statusCode === 409) return res.status(409).json({ error: e.message });
    handleError(res, e, 'Erreur suppression client');
  }
});

// Shared workstation procedures; all writes inherit the global origin guard.
function workstationId(req) {
  const id=Number(req.params.id);
  if(!Number.isSafeInteger(id)||id<=0) throw Object.assign(new Error('ID invalide'),{statusCode:400});
  return id;
}
function workstationRoute(fn,status=200){return async(req,res)=>{
  try {res.status(status).json(await fn(req));}
  catch(error){if([400,403,404,409].includes(error.statusCode))return res.status(error.statusCode).json({error:error.message});handleError(res,error,'Erreur procédure de poste');}
};}
app.get('/api/workstation-procedures/templates',auth.requireAuth,workstationRoute(req=>db.listWorkstationTemplates(req.auth,req.query)));
app.get('/api/workstation-procedures/templates/standard',auth.requireAuth,workstationRoute(()=>db.standardWorkstationTemplate()));
app.get('/api/workstation-procedures/templates/by-request/:requestKey',auth.requireAuth,workstationRoute(req=>db.reconcileWorkstationTemplate(req.auth,req.params.requestKey)));
app.post('/api/workstation-procedures/templates',auth.requireAuth,workstationRoute(req=>db.createWorkstationTemplate(req.auth,req.body),201));
app.put('/api/workstation-procedures/templates/:id',auth.requireAuth,workstationRoute(req=>db.updateWorkstationTemplate(req.auth,workstationId(req),req.body)));
app.get('/api/workstation-procedures/dossiers',auth.requireAuth,workstationRoute(req=>db.listWorkstationDossiers(req.auth,req.query)));
app.get('/api/workstation-procedures/dossiers/by-request/:requestKey',auth.requireAuth,workstationRoute(req=>db.reconcileWorkstationDossier(req.auth,req.params.requestKey)));
app.get('/api/workstation-procedures/dossiers/:id',auth.requireAuth,workstationRoute(req=>db.getWorkstationDossier(req.auth,workstationId(req))));
app.post('/api/workstation-procedures/dossiers',auth.requireAuth,workstationRoute(req=>db.createWorkstationDossier(req.auth,req.body),201));
app.put('/api/workstation-procedures/dossiers/:id',auth.requireAuth,workstationRoute(req=>db.updateWorkstationDossier(req.auth,workstationId(req),req.body)));
app.post('/api/workstation-procedures/dossiers/:id/archive',auth.requireAuth,workstationRoute(req=>db.archiveWorkstationDossier(req.auth,workstationId(req),req.body?.expectedVersion)));

// Prime-owned prise en charge. All authority comes from the current session.
function onboardingError(res, error) {
  if ([400,404,409,413].includes(error?.statusCode)) return res.status(error.statusCode).json({ error:error.message });
  return handleError(res,error,'Erreur prise en charge client');
}
function onboardingId(req) {
  const id=Number(req.params.id);
  if(!Number.isSafeInteger(id)||id<=0) throw Object.assign(new Error('ID invalide'),{statusCode:400});
  return id;
}
app.get('/api/client-onboardings/options',auth.requireAuth,async(req,res)=>{
  try {res.json(await db.clientOnboardingOptions(req.auth));}catch(e){onboardingError(res,e);}
});
app.get('/api/client-onboardings/reconcile',auth.requireAuth,async(req,res)=>{
  try {res.json(await db.reconcileClientOnboarding(req.query.requestKey,req.auth));}catch(e){onboardingError(res,e);}
});
app.get('/api/client-onboardings',auth.requireAuth,async(req,res)=>{
  try {res.json(await db.listClientOnboardings(req.auth,req.query));}catch(e){onboardingError(res,e);}
});
app.get('/api/client-onboardings/:id/history',auth.requireAuth,async(req,res)=>{
  try {res.json(await db.getClientOnboardingHistory(onboardingId(req),req.auth,req.query));}catch(e){onboardingError(res,e);}
});
app.get('/api/client-onboardings/:id',auth.requireAuth,async(req,res)=>{
  try {res.json(await db.getClientOnboarding(onboardingId(req),req.auth));}catch(e){onboardingError(res,e);}
});
app.post('/api/client-onboardings',auth.requireAuth,async(req,res)=>{
  try {res.status(201).json(await db.createClientOnboarding(req.body?.onboarding,req.body?.items,req.auth,req.body?.requestKey));}catch(e){onboardingError(res,e);}
});
app.put('/api/client-onboardings/:id',auth.requireAuth,async(req,res)=>{
  try {res.json(await db.updateClientOnboarding(onboardingId(req),req.body?.onboarding,req.body?.items,req.auth,req.body?.expectedVersion));}catch(e){onboardingError(res,e);}
});
app.delete('/api/client-onboardings/:id',auth.requireAuth,async(req,res)=>{
  try {res.json(await db.archiveClientOnboarding(onboardingId(req),req.auth,req.body?.expectedVersion));}catch(e){onboardingError(res,e);}
});
app.post('/api/client-onboardings/:id/restore',auth.requireAuth,async(req,res)=>{
  try {res.json(await db.restoreClientOnboarding(onboardingId(req),req.auth,req.body?.expectedVersion));}catch(e){onboardingError(res,e);}
});

// Suivis
app.get('/api/tableaux-suivi', auth.requireAuth, async (req, res) => {
  try { res.json({ tableaux: await db.listTableaux(req.auth.sub, req.auth.role === 'admin') }); }
  catch (error) { handleError(res, error, 'Erreur chargement des tableaux'); }
});
app.post('/api/tableaux-suivi', auth.requireAuth, async (req, res) => {
  try {
    const clientId = req.body?.clientId;
    const expectedActiveId = req.body?.expectedActiveId;
    if (!Number.isSafeInteger(clientId) || clientId <= 0) return res.status(400).json({ error: 'Client invalide' });
    if (!Object.hasOwn(req.body ?? {}, 'expectedActiveId') ||
      (expectedActiveId !== null && (!Number.isSafeInteger(expectedActiveId) || expectedActiveId <= 0)))
      return res.status(400).json({ error: 'Tableau courant attendu invalide' });
    res.status(201).json({ tableau: await db.createTableau(clientId, req.auth.sub, req.auth.role === 'admin', expectedActiveId) });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    handleError(res, error, 'Erreur création tableau');
  }
});
app.put('/api/tableaux-suivi/:id/rubriques/:key', auth.requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Tableau invalide' });
    res.json({ tableau: await db.updateTableauRubrique(id, req.params.key, req.body, req.auth.sub, req.auth.role === 'admin') });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    handleError(res, error, 'Erreur mise à jour tableau');
  }
});

app.get('/api/suivis', auth.requireAuth, async (req, res) => {
  try { res.json({ suivis: req.auth.role === 'admin' ? await db.listSuivis() : await db.listSuivisForUser(req.auth.sub) }); }
  catch (e) { handleError(res, e, 'Erreur chargement des suivis'); }
});
app.post('/api/suivis', auth.requireAuth, auth.requireAdmin, (_req, res) => {
  res.status(410).json({ error: 'Anciens suivis en lecture seule; utilisez les tableaux par client.' });
});
app.put('/api/suivis/:id', auth.requireAuth, auth.requireAdmin, (_req, res) => {
  res.status(410).json({ error: 'Anciens suivis en lecture seule; utilisez les tableaux par client.' });
});
app.delete('/api/suivis/:id', auth.requireAuth, auth.requireAdmin, (_req, res) => {
  res.status(410).json({ error: 'Anciens suivis conservés en lecture seule.' });
});

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
  const created = await db.seedAdminIfNone({ email, passwordHash, prenom: 'Jean-Michel', nom: 'Caouette' });
  if (created) console.log(`🌱 Administrateur initial créé : ${email} (mot de passe par défaut à changer).`);
}

async function start() {
  await db.initDb();
  await seedFirstAdmin();
  await db.seedMetier();
  app.listen(PORT, () => console.log(`🚀 PRIsME Prime API — port ${PORT}`));
}

start().catch((err) => {
  console.error('Échec du démarrage du serveur:', err);
  process.exit(1);
});

export default app;
