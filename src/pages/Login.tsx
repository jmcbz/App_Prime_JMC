import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { login, confirmMfaSetup, verifyMfaLogin } from '../services/authService';

type Etape = 'credentials' | 'mfa_setup' | 'mfa_verify';

export default function Login() {
  const { setUser } = useAuth();
  const navigate = useNavigate();

  const [etape, setEtape] = useState<Etape>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [otpauthUrl, setOtpauthUrl] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [mfaToken, setMfaToken] = useState('');
  const [erreur, setErreur] = useState('');
  const [busy, setBusy] = useState(false);

  const secretFromUrl = otpauthUrl.match(/secret=([A-Z2-7]+)/)?.[1] || '';

  async function soumettreCredentials(e: React.FormEvent) {
    e.preventDefault();
    setErreur(''); setBusy(true);
    const res = await login(email, password);
    setBusy(false);
    if (res.status === 'authenticated') { setUser(res.user); navigate('/'); return; }
    if (res.status === 'mfa_setup_required') {
      setQrDataUrl(res.qrDataUrl); setOtpauthUrl(res.otpauthUrl); setSetupToken(res.setupToken);
      setEtape('mfa_setup'); return;
    }
    if (res.status === 'mfa_required') { setMfaToken(res.mfaToken); setEtape('mfa_verify'); return; }
    setErreur(res.error);
  }

  async function soumettreCode(e: React.FormEvent) {
    e.preventDefault();
    setErreur(''); setBusy(true);
    const res = etape === 'mfa_setup'
      ? await confirmMfaSetup(setupToken, code)
      : await verifyMfaLogin(mfaToken, code);
    setBusy(false);
    if (res.status === 'authenticated') { setUser(res.user); navigate('/'); return; }
    setErreur(res.status === 'error' ? res.error : 'Code invalide');
    setCode('');
  }

  return (
    <div className="flex min-h-screen items-center justify-center titan-grid px-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-bz-dark2/90 p-8 shadow-titan backdrop-blur">
        <div className="mb-6 flex items-center gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-titan-cyan to-bz-blue text-xl font-extrabold text-bz-dark shadow-titan">
            T
          </span>
          <div>
            <div className="text-lg font-extrabold text-white">PRIsME Prime</div>
            <div className="text-xs font-medium text-titan-cyan">Tour des Titans BZ</div>
          </div>
        </div>

        {etape === 'credentials' && (
          <form onSubmit={soumettreCredentials} className="space-y-4">
            <h1 className="text-sm font-semibold text-slate-300">Connexion</h1>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Courriel</label>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-bz-dark px-3 py-2.5 text-sm text-white outline-none focus:border-bz-blue" autoFocus />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Mot de passe</label>
              <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-bz-dark px-3 py-2.5 text-sm text-white outline-none focus:border-bz-blue" />
            </div>
            {erreur && <p className="text-sm text-red-400">{erreur}</p>}
            <button type="submit" disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-bz-blue py-2.5 text-sm font-semibold text-white transition-colors hover:bg-bz-blue2 disabled:opacity-60">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Se connecter
            </button>
          </form>
        )}

        {etape === 'mfa_setup' && (
          <form onSubmit={soumettreCode} className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <ShieldCheck className="h-4 w-4 text-titan-cyan" /> Configuration de la double authentification
            </div>
            <p className="text-xs text-slate-400">
              Scannez ce code QR avec votre application d’authentification (Google Authenticator, Microsoft Authenticator, etc.), puis saisissez le code à 6 chiffres.
            </p>
            {qrDataUrl && (
              <div className="flex justify-center">
                <img src={qrDataUrl} alt="QR MFA" className="h-44 w-44 rounded-lg bg-white p-2" />
              </div>
            )}
            {secretFromUrl && (
              <p className="text-center text-[11px] text-slate-500">
                Clé manuelle : <span className="font-mono text-slate-300">{secretFromUrl}</span>
              </p>
            )}
            <CodeInput code={code} setCode={setCode} />
            {erreur && <p className="text-sm text-red-400">{erreur}</p>}
            <button type="submit" disabled={busy || code.length !== 6}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-bz-blue py-2.5 text-sm font-semibold text-white transition-colors hover:bg-bz-blue2 disabled:opacity-60">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Activer et continuer
            </button>
          </form>
        )}

        {etape === 'mfa_verify' && (
          <form onSubmit={soumettreCode} className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <ShieldCheck className="h-4 w-4 text-titan-cyan" /> Vérification
            </div>
            <p className="text-xs text-slate-400">Saisissez le code à 6 chiffres de votre application d’authentification.</p>
            <CodeInput code={code} setCode={setCode} />
            {erreur && <p className="text-sm text-red-400">{erreur}</p>}
            <button type="submit" disabled={busy || code.length !== 6}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-bz-blue py-2.5 text-sm font-semibold text-white transition-colors hover:bg-bz-blue2 disabled:opacity-60">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Vérifier
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function CodeInput({ code, setCode }: { code: string; setCode: (v: string) => void }) {
  return (
    <input
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={6}
      value={code}
      onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
      placeholder="000000"
      autoFocus
      className="w-full rounded-xl border border-white/10 bg-bz-dark py-2.5 text-center font-mono text-xl tracking-[0.5em] text-white outline-none focus:border-bz-blue"
    />
  );
}
