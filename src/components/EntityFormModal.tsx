import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Save } from 'lucide-react';

export type ChampType = 'text' | 'textarea' | 'select' | 'tags' | 'date';

export interface ChampDef {
  nom: string;              // clé dans l'objet valeurs
  label: string;
  type: ChampType;
  requis?: boolean;
  options?: { value: string; label: string }[]; // pour select
  placeholder?: string;
  aide?: string;
}

interface Props {
  titre: string;
  champs: ChampDef[];
  valeurs: Record<string, unknown>;
  onChange: (nom: string, valeur: unknown) => void;
  onSubmit: () => Promise<void> | void;
  onClose: () => void;
}

/** Modal de formulaire générique (thème PRIsME sombre + accents Titans). */
export default function EntityFormModal({ titre, champs, valeurs, onChange, onSubmit, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  async function soumettre(e: React.FormEvent) {
    e.preventDefault();
    setErreur(''); setBusy(true);
    try {
      await onSubmit();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Erreur');
      setBusy(false);
      return;
    }
    setBusy(false);
  }

  if (typeof document === 'undefined' || !document.body) return null;

  const inputCls = 'w-full rounded-xl border border-white/10 bg-bz-dark px-3 py-2 text-sm text-white outline-none focus:border-bz-blue';

  return createPortal(
    <>
      <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-lg rounded-2xl border border-white/10 bg-bz-dark2 shadow-titan">
          <div className="flex items-center justify-between border-b border-white/10 bg-gradient-to-r from-bz-blue/20 to-titan-violet/20 px-5 py-4">
            <h2 className="text-base font-bold text-white">{titre}</h2>
            <button type="button" onClick={onClose} className="rounded-full p-1.5 text-slate-300 hover:bg-white/10 hover:text-white">
              <X className="h-5 w-5" />
            </button>
          </div>

          <form onSubmit={soumettre} className="max-h-[70vh] space-y-3 overflow-y-auto p-5">
            {champs.map((c) => {
              const val = valeurs[c.nom];
              return (
                <div key={c.nom}>
                  <label className="mb-1 block text-xs font-medium text-slate-400">
                    {c.label}{c.requis && <span className="text-red-400"> *</span>}
                  </label>
                  {c.type === 'textarea' && (
                    <textarea className={inputCls} rows={3} value={String(val ?? '')} placeholder={c.placeholder}
                      onChange={(e) => onChange(c.nom, e.target.value)} />
                  )}
                  {c.type === 'select' && (
                    <select className={inputCls} value={String(val ?? '')} onChange={(e) => onChange(c.nom, e.target.value)}>
                      {c.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  )}
                  {c.type === 'tags' && (
                    <input className={inputCls} value={Array.isArray(val) ? (val as string[]).join(', ') : String(val ?? '')}
                      placeholder={c.placeholder || 'Séparés par des virgules'}
                      onChange={(e) => onChange(c.nom, e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />
                  )}
                  {(c.type === 'text' || c.type === 'date') && (
                    <input type={c.type === 'date' ? 'date' : 'text'} className={inputCls} value={String(val ?? '')}
                      placeholder={c.placeholder} onChange={(e) => onChange(c.nom, e.target.value)} />
                  )}
                  {c.aide && <p className="mt-1 text-[11px] text-slate-500">{c.aide}</p>}
                </div>
              );
            })}

            {erreur && <p className="text-sm text-red-400">{erreur}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-300 hover:text-white">
                Annuler
              </button>
              <button type="submit" disabled={busy}
                className="inline-flex items-center gap-2 rounded-xl bg-bz-blue px-4 py-2 text-sm font-semibold text-white hover:bg-bz-blue2 disabled:opacity-60">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Enregistrer
              </button>
            </div>
          </form>
        </div>
      </div>
    </>,
    document.body
  );
}
