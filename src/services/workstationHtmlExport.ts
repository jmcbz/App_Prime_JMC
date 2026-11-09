import type { DossierSection, TemplateSection, WorkstationDossier, WorkstationTemplate } from './workstationProcedures';

/** The caller must obtain the selected template/client or dossier from an authorized server read. */
export type WorkstationProcedureHtmlSource =
  | { kind: 'template'; clientName: string; template: WorkstationTemplate }
  | { kind: 'dossier'; dossier: WorkstationDossier };

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]!);
const text = (value: string): string => escapeHtml(value);
const validSections = (value: unknown, saved: boolean): value is TemplateSection[] | DossierSection[] =>
  Array.isArray(value) && value.every(section => section && typeof section.title === 'string' &&
    Array.isArray(section.steps) && section.steps.every((step: Record<string, unknown>) =>
      step && typeof step.title === 'string' && typeof step.note === 'string' &&
      (!saved || (['fait', 'todo', 'na'].includes(step.etat as string) && typeof step.commentaire === 'string'))));
const validText = (value: unknown): value is string => typeof value === 'string';

/** Complete, immutable HTML snapshot. No runtime script, persistence or remote dependencies. */
export function generateWorkstationProcedureHtml(source: WorkstationProcedureHtmlSource): string {
  if (!source || (source.kind !== 'template' && source.kind !== 'dossier')) throw new Error('Source de procédure invalide');
  const saved = source.kind === 'dossier';
  const data = saved ? source.dossier : source.template;
  const sections = data?.sections;
  const clientName = saved ? source.dossier?.clientName : source.clientName;
  if (!validText(clientName) || !clientName.trim() || !validSections(sections, saved) ||
    (saved && ![source.dossier.employee, source.dossier.computer, source.dossier.ticket, source.dossier.date].every(validText)) ||
    (!saved && (!validText(source.template.name) || !source.template.name.trim()))) {
    throw new Error('Source de procédure invalide');
  }
  const title = saved ? 'Procédure de montage de poste' : source.template.name;
  const metadata = saved ? [
    ['Employé', source.dossier.employee], ['Ordinateur', source.dossier.computer],
    ['Billet', source.dossier.ticket], ['Date', source.dossier.date],
  ] : [];
  const dossierSteps = saved ? (sections as DossierSection[]).flatMap(section => section.steps) : [];
  const applicable = dossierSteps.filter(step => step.etat !== 'na');
  const done = applicable.filter(step => step.etat === 'fait').length;
  const progress = saved ? `<div class="progress" aria-label="Progression"><strong>${done} / ${applicable.length} étapes applicables terminées</strong><div class="track"><div class="fill" style="width:${applicable.length ? Math.round(done / applicable.length * 100) : 0}%"></div></div></div>` : '';
  const cards = sections.map((section, index) => `<section class="section">
    <h2><span class="section-number">${index + 1}</span>${text(section.title)}<small>${section.steps.length} étape${section.steps.length === 1 ? '' : 's'}</small></h2>
    <div class="steps">${section.steps.map((step, i) => {
      const state = saved && 'etat' in step ? step.etat : null;
      const stateText = state === 'fait' ? 'Fait' : state === 'todo' ? 'À faire' : state === 'na' ? 'N/A' : '';
      return `<article class="step"><span class="step-number">${i + 1}</span><div class="step-content"><h3>${text(step.title)}</h3>${step.note ? `<p class="note">${text(step.note)}</p>` : ''}${saved && 'commentaire' in step && step.commentaire ? `<p class="comment"><strong>Commentaire :</strong> ${text(step.commentaire)}</p>` : ''}</div>${state ? `<span class="step-status ${state}">${stateText}</span>` : ''}</article>`;
    }).join('')}</div>
  </section>`).join('');
  return `<!doctype html><html lang="fr-CA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${text(title)} — ${text(clientName)}</title><style>
:root{color-scheme:light;--navy:#122443;--blue:#27659d;--teal:#12695f;--ink:#1d2a39;--line:#d5dee9;--muted:#536477}
*{box-sizing:border-box}body{margin:0;background:#eef2f7;color:var(--ink);font:15px/1.55 system-ui,"Segoe UI",Arial,sans-serif}header{background:linear-gradient(120deg,#122443,#264d78);color:white;padding:28px max(20px,calc((100vw - 960px)/2));border-bottom:5px solid #1b8275}header .eyebrow{font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;color:#d1e5f8}h1{font-size:1.7rem;line-height:1.25;margin:5px 0}header p{margin:0;color:#e3edf8}main{max-width:980px;margin:auto;padding:22px 16px 48px}.summary,.section{background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:0 2px 10px #12244312;margin-bottom:18px;overflow:hidden}.summary{padding:20px}.summary h2{margin:0 0 12px;font-size:1rem;color:var(--navy)}.metadata{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.meta{min-width:0;overflow-wrap:anywhere}.meta dt{font-size:.72rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:700}.meta dd{margin:2px 0 0;white-space:pre-wrap;font-weight:600}.progress{margin-top:18px}.track{height:9px;background:#e1e9f2;border-radius:9px;overflow:hidden;margin-top:7px}.fill{background:#128171;height:100%}.section h2{display:flex;align-items:center;gap:10px;margin:0;padding:12px 16px;background:#173456;color:#fff;font-size:1rem;overflow-wrap:anywhere}.section h2 small{margin-left:auto;font-size:.76rem;font-weight:500;white-space:nowrap;color:#dce9f4}.section-number,.step-number{display:inline-grid;place-items:center;flex:none;border-radius:6px;font-size:.78rem;font-weight:700}.section-number{width:27px;height:27px;background:#3170a5}.step{display:flex;align-items:flex-start;gap:12px;padding:13px 16px;border-top:1px solid var(--line);break-inside:avoid}.step-number{width:23px;height:23px;background:#e7f0f9;color:var(--blue)}.step-content{flex:1;min-width:0;overflow-wrap:anywhere}.step h3{font-size:.94rem;margin:0;font-weight:650}.note,.comment{white-space:pre-wrap;margin:4px 0 0;font-size:.84rem}.note{color:var(--muted)}.comment{border-left:3px solid var(--teal);padding:4px 9px;background:#f1f8f6}.step-status{flex:none;border-radius:30px;padding:2px 9px;font-size:.76rem;font-weight:700;border:1px solid}.step-status.fait{background:#e4f3e9;color:#176236;border-color:#a8d5b7}.step-status.todo{background:#fff2d8;color:#774300;border-color:#e0bd7b}.step-status.na{background:#e9edf2;color:#414e5f;border-color:#bdc9d7}footer{text-align:center;font-size:.76rem;color:var(--muted)}
@media(max-width:540px){header{padding:24px 16px}.step{flex-wrap:wrap}.step-status{margin-left:35px}.section h2{align-items:flex-start}.section h2 small{white-space:normal;text-align:right}}
@media print{@page{size:letter;margin:12mm}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}body{background:#fff;color:#111;font-size:10pt}header{padding:10px 14px;background:#173456;color:#fff}header h1{font-size:17pt}main{padding:12px 0}.summary,.section{box-shadow:none;border:1px solid #9cabb9;margin-bottom:10px;break-inside:auto}.summary{padding:12px}.section h2{background:#173456;color:white;break-after:avoid}.step{padding:7px 10px;break-inside:avoid}.note,.comment{color:#202b35}.step-status{border:1px solid #555}footer{color:#444}}
</style></head><body><header><div class="eyebrow">Procédures TI · Consultation hors ligne</div><h1>${text(title)}</h1><p>Client : ${text(clientName)}</p></header><main><div class="summary"><h2>${saved ? 'Dossier enregistré' : 'Modèle · statut non renseigné'}</h2><dl class="metadata"><div class="meta"><dt>Client</dt><dd>${text(clientName)}</dd></div><div class="meta"><dt>Procédure</dt><dd>${text(title)}</dd></div>${metadata.map(([label, value]) => `<div class="meta"><dt>${label}</dt><dd>${text(value)}</dd></div>`).join('')}</dl>${progress}</div>${cards}<footer>Copie en lecture seule · Aucune modification ni synchronisation avec Prime.</footer></main></body></html>`;
}
