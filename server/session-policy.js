import crypto from 'node:crypto';

export function getJwtSecret() {
  return process.env.JWT_SECRET || 'app-prime-dev-secret-change-in-production';
}

export function mfaVersion(mfa) {
  if (!mfa?.mfa_enabled || !mfa.secret_encrypted) return null;
  return crypto.createHmac('sha256', getJwtSecret()).update(mfa.secret_encrypted).digest('hex');
}

// Used only with a JWT already cryptographically verified by requireAuth.
// Transactional callers must lock/read these current rows after their wait.
export function currentSessionActor(decoded, user, mfa) {
  const version = mfaVersion(mfa);
  if (decoded?.purpose !== 'session' || !user || !user.is_active ||
      decoded.sub !== user.id || !version || decoded.mfaVersion !== version ||
      !Number.isFinite(decoded.exp) || decoded.exp <= Date.now() / 1000) return null;
  return { ...decoded, sub: user.id, email: user.email, role: user.role };
}
