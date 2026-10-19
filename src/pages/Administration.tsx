import { useEffect, useState } from 'react';
import { UserPlus, RotateCcw, ShieldCheck, ShieldAlert, Loader2, Power } from 'lucide-react';
import { Page, PageHeader } from '../layout/Page';
import { Card } from '../components/ui';
import { listUsers, createUser, updateUser, resetMfa, type AdminUser } from '../services/adminService';
import type { Role } from '../services/authService';

export default function Administration() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState('');
  const [ok, setOk] = useState('');

  // Formulaire création
  const [form, setForm] = useState({ prenom: '', nom: '', email: '', password: '', role: 'prime' as Role });
  const [creating, setCreating] = useState(false);

  async function charger() {
    try {
      setUsers(await listUsers());
      setErreur('');
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { charger(); }, []);

  function flash(msg: string) { setOk(msg); setTimeout(() => setOk(''), 2500); }

  async function soumettreCreation(e: React.FormEvent) {
    e.preventDefault();
    setErreur(''); setCreating(true);
    try {
      await createUser(form);
      setForm({ prenom: '', nom: '', email: '', password: '', role: 'prime' });
      flash('Usager créé. Le MFA sera configuré à sa première connexion.');
      await charger();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Erreur de création');
    } finally {
      setCreating(false);
    }
  }

  async function changerRole(u: AdminUser, role: Role) {
    try { await updateUser(u.id, { role }); await charger(); flash('Rôle mis à jour.'); }
    catch (e) { setErreur(e instanceof Error ? e.message : 'Erreur'); }
  }
  async function basculerActif(u: AdminUser) {
    try { await updateUser(u.id, { is_active: !u.is_active }); await charger(); flash('Statut mis à jour.'); }
    catch (e) { setErreur(e instanceof Error ? e.message : 'Erreur'); }
  }
  async function reinitialiserMfa(u: AdminUser) {
    try { await resetMfa(u.id); await charger(); flash('MFA réinitialisé — l’usager reconfigurera à sa prochaine connexion.'); }
    catch (e) { setErreur(e instanceof Error ? e.message : 'Erreur'); }
  }

  return (
    <Page>
      <PageHeader titre="Administration" sousTitre="Gestion des accès et des usagers — rôles, activation et double authentification." />

      {erreur && <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-400">{erreur}</div>}
      {ok && <div className="mb-4 rounded-xl border border-bz-emerald/30 bg-bz-emerald/10 px-4 py-2.5 text-sm text-bz-emerald">{ok}</div>}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <div className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-300">
            <UserPlus className="h-4 w-4 text-titan-cyan" /> Nouvel usager
          </div>
          <form onSubmit={soumettreCreation} className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <input placeholder="Prénom" value={form.prenom} onChange={(e) => setForm({ ...form, prenom: e.target.value })}
                className="rounded-xl border border-white/10 bg-bz-dark px-3 py-2 text-sm text-white outline-none focus:border-bz-blue" />
              <input placeholder="Nom" value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })}
                className="rounded-xl border border-white/10 bg-bz-dark px-3 py-2 text-sm text-white outline-none focus:border-bz-blue" />
            </div>
            <input type="email" required placeholder="Courriel" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full rounded-xl border border-white/10 bg-bz-dark px-3 py-2 text-sm text-white outline-none focus:border-bz-blue" />
            <input type="password" required placeholder="Mot de passe (min. 8 caractères)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="w-full rounded-xl border border-white/10 bg-bz-dark px-3 py-2 text-sm text-white outline-none focus:border-bz-blue" />
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
              className="w-full rounded-xl border border-white/10 bg-bz-dark px-3 py-2 text-sm text-white outline-none focus:border-bz-blue">
              <option value="prime">Prime (usager standard)</option>
              <option value="admin">Administrateur</option>
            </select>
            <button type="submit" disabled={creating}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-bz-blue py-2.5 text-sm font-semibold text-white transition-colors hover:bg-bz-blue2 disabled:opacity-60">
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Créer l’usager
            </button>
            <p className="text-[11px] text-slate-500">Le MFA (TOTP) est obligatoire : l’usager le configure lui-même à sa première connexion.</p>
          </form>
        </Card>

        <Card className="lg:col-span-2 p-0">
          <div className="border-b border-white/10 px-5 py-3 text-sm font-bold uppercase tracking-wide text-slate-300">
            Usagers ({users.length})
          </div>
          {loading ? (
            <div className="flex items-center gap-2 px-5 py-8 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Chargement…</div>
          ) : (
            <ul className="divide-y divide-white/5">
              {users.map((u) => (
                <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">{u.prenom} {u.nom}</span>
                      {u.mfa_enabled
                        ? <span className="inline-flex items-center gap-1 text-[11px] text-bz-emerald"><ShieldCheck className="h-3 w-3" /> MFA actif</span>
                        : <span className="inline-flex items-center gap-1 text-[11px] text-bz-amber"><ShieldAlert className="h-3 w-3" /> MFA à configurer</span>}
                      {!u.is_active && <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-medium text-red-400">Désactivé</span>}
                    </div>
                    <div className="text-xs text-slate-400">{u.email}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <select value={u.role} onChange={(e) => changerRole(u, e.target.value as Role)}
                      className="rounded-lg border border-white/10 bg-bz-dark px-2 py-1 text-xs text-white outline-none focus:border-bz-blue">
                      <option value="prime">Prime</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button onClick={() => reinitialiserMfa(u)} title="Réinitialiser le MFA"
                      className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-300 hover:text-white">
                      <RotateCcw className="h-3.5 w-3.5" /> MFA
                    </button>
                    <button onClick={() => basculerActif(u)} title={u.is_active ? 'Désactiver' : 'Activer'}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs ${u.is_active ? 'border-red-500/30 bg-red-500/10 text-red-400' : 'border-bz-emerald/30 bg-bz-emerald/10 text-bz-emerald'}`}>
                      <Power className="h-3.5 w-3.5" /> {u.is_active ? 'Désactiver' : 'Activer'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </Page>
  );
}
