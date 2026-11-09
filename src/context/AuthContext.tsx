import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { checkAuth, logout as apiLogout, type User } from '../services/authService';
import { advanceOnboardingSessionGeneration, currentOnboardingSessionGeneration } from '../services/onboardingSessionGeneration.ts';

interface AuthState {
  user: User | null;
  loading: boolean;
  verified: boolean;
  verificationEpoch: number;
  setUser: (u: User | null) => void;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  onVerificationStart: (listener: () => void) => () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);
const pendingPrefix = 'client-onboarding:pending-create:';
const workstationPrefix = 'workstation-procedures:pending-create:';
const pendingPrefixes = [pendingPrefix, workstationPrefix];

// Session storage is origin-wide, not protected by the account id in a key.
function discardOtherAccountDrafts(keepId: number | null) {
  const storage = window.sessionStorage;
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && pendingPrefixes.some(prefix => key.startsWith(prefix) && key !== (keepId == null ? null : `${prefix}${keepId}`))) keys.push(key);
  }
  for (const key of keys) {
    storage.removeItem(key);
    if (storage.getItem(key) !== null) throw new Error('Nettoyage du brouillon impossible');
  }
}

function hasPendingDraft() {
  const storage = window.sessionStorage;
  for (let i = 0; i < storage.length; i++) {
    if (pendingPrefixes.some(prefix => storage.key(i)?.startsWith(prefix))) return true;
  }
  return false;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [verified, setVerified] = useState(false);
  const [verificationEpoch, setVerificationEpoch] = useState(0);
  const identity = useRef<number | null>(null);
  const requestEpoch = useRef(0);
  const pendingRefreshEpoch = useRef<number | null>(null);
  const verificationListeners = useRef(new Set<() => void>());
  const onVerificationStart = useCallback((listener: () => void) => {
    verificationListeners.current.add(listener);
    return () => { verificationListeners.current.delete(listener); };
  }, []);
  const loggingOut = useRef(false);
  const logoutBlocked = useRef(false);
  const [storageError, setStorageError] = useState('');
  const [logoutError, setLogoutError] = useState('');

  const applyUser = (next: User | null, confirmedByMe = false) => {
    requestEpoch.current++;
    const identityChanged = identity.current !== (next?.id ?? null);
    // Invalidate old-account exports synchronously even if storage cleanup
    // fails; React effects and state updates happen too late for a download.
    if (identityChanged) for (const listener of verificationListeners.current) listener();
    try {
      // On initial /me, retain only this account's recoverable draft. A later
      // identity change (including expiry) destroys all drafts before UI switches.
      discardOtherAccountDrafts(identity.current === null ? next?.id ?? null :
        identity.current === next?.id ? next?.id ?? null : null);
      if (identityChanged || confirmedByMe) {
        // A successful /me also supersedes requests issued before verification,
        // even when it confirms the same account.
        advanceOnboardingSessionGeneration();
      }
      identity.current = next?.id ?? null;
      setStorageError('');
      setUser(next);
      setVerified(true);
    } catch (error) {
      setVerified(false);
      setStorageError('Nettoyage des brouillons impossible. Changement de compte bloqué; fermez cet onglet ou rétablissez le stockage de session.');
      throw error;
    }
  };

  const refresh = async () => {
    if (loggingOut.current || logoutBlocked.current) return;
    const epoch = ++requestEpoch.current;
    pendingRefreshEpoch.current = epoch;
    // Invalidate downloads now, before React can commit the concealed shell.
    for (const listener of verificationListeners.current) listener();
    setVerificationEpoch(epoch);
    setVerified(false);
    setLoading(true); // Hide the old account while /me is in flight.
    let applied = false;
    try {
      const u = await checkAuth();
      if (epoch === requestEpoch.current) { applied = true; applyUser(u, true); }
    } catch (error) {
      if (epoch === requestEpoch.current) {
        // Unknown identity: conceal loaded UI without destroying the recovery
        // key. The next confirmed identity either recovers it or purges it.
        applied = true;
        setVerified(false);
      }
      throw error;
    } finally {
      if (pendingRefreshEpoch.current === epoch) pendingRefreshEpoch.current = null;
      if (applied || epoch === requestEpoch.current) setLoading(false);
    }
  };

  useEffect(() => {
    const revalidate = () => { void refresh().catch(() => {}); };
    const onVisibility = () => { if (document.visibilityState === 'visible') revalidate(); };
    window.addEventListener('focus', revalidate);
    document.addEventListener('visibilitychange', onVisibility);
    revalidate();
    const onUnauthorized = (event: Event) => {
      if ((event as CustomEvent<{generation?: number}>).detail?.generation !== currentOnboardingSessionGeneration()) return;
      // Abort before any React state update/effect cleanup: a pending document
      // build can otherwise finish and download the previous account's data.
      for (const listener of verificationListeners.current) listener();
      if (pendingRefreshEpoch.current === requestEpoch.current) {
        // /me is authoritative for this verification epoch. Keep the old
        // editor concealed and its recoverable draft until it settles.
        setVerified(false);
        return;
      }
      requestEpoch.current++;
      setLoading(false);
      logoutBlocked.current = false;
      setLogoutError('');
      try { applyUser(null); } catch { /* storageError hides the account */ }
    };
    window.addEventListener('client-onboarding:unauthorized', onUnauthorized);
    return () => {
      requestEpoch.current++;
      window.removeEventListener('focus', revalidate);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('client-onboarding:unauthorized', onUnauthorized);
    };
  }, []);

  const logout = async (retry = false) => {
    if (loggingOut.current) return;
    if (!retry) {
      if (hasPendingDraft() && !window.confirm('Une création peut avoir été reçue par le serveur sans confirmation. Se déconnecter détruit le brouillon et sa clé de récupération; vérifiez la création avant de continuer. Détruire la récupération et se déconnecter?')) return;
      // Do not invalidate the server session until the full browser draft is gone.
      discardOtherAccountDrafts(null);
    }
    loggingOut.current = true;
    logoutBlocked.current = true;
    for (const listener of verificationListeners.current) listener();
    requestEpoch.current++;
    advanceOnboardingSessionGeneration();
    identity.current = null;
    setUser(null);
    setVerified(false);
    setLoading(false);
    try {
      await apiLogout();
      setLogoutError('');
    } catch (error) {
      // A failed POST may still have invalidated the cookie. Only a confirmed
      // 401 from /me proves sign-out; otherwise keep all account UI concealed.
      let sessionActive = true;
      try { sessionActive = (await checkAuth()) !== null; } catch { /* identity remains unknown */ }
      if (sessionActive) {
        setLogoutError('Déconnexion impossible ou incertaine. La session peut encore être active; réessayer la déconnexion.');
        throw error;
      }
      setLogoutError('');
    } finally { loggingOut.current = false; }
  };

  return (
    <AuthContext.Provider value={{ user: storageError || logoutBlocked.current ? null : user, loading, verified: !storageError && !logoutBlocked.current && verified, verificationEpoch, setUser: (next) => { logoutBlocked.current = false; try { applyUser(next); } finally { setLoading(false); } }, logout, refresh, onVerificationStart }}>
      {storageError ? <div role="alert">{storageError}</div> : logoutError ? (
        <div role="alert" className="min-h-screen p-8 text-white">
          <p>{logoutError}</p>
          <button type="button" onClick={() => { void logout(true).catch(() => {}); }} className="mt-4 rounded border px-4 py-2">Réessayer la déconnexion</button>
        </div>
      ) : children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans AuthProvider');
  return ctx;
}
