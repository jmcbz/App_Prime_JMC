import type { ClientOnboarding, ClientOnboardingItem } from './clientOnboardingService';

const metadata = [['Client','client_nom'],['Titre','titre'],['Statut','statut'],['Priorité','priorite'],['Technicien','technicien_nom'],['Urgence TI','urgence_ti'],['Site principal','site_principal'],['Contact principal','contact_principal'],['Période couverte','periode_couverte'],['Préparé pour','prepare_pour'],['Avancement global','avancement_global'],['Risques critiques','risques_critiques'],['Actions ouvertes','actions_ouvertes'],['Décisions requises','decisions_requises'],['Prochaine rencontre','prochaine_rencontre']] as const;
const report = [['Résumé exécutif','resume_executif'],['Points validés','points_valides'],['Points à corriger','points_a_corriger'],['Recommandations prioritaires','recommandations_prioritaires'],['Prochaines étapes','prochaines_etapes']] as const;
const fileName = (name:string, ext:string) => `prise_en_charge_${name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,60)}_${new Date().toISOString().slice(0,10)}.${ext}`;
const text = (value: unknown) => value == null ? '' : String(value);
function download(blob:Blob, name:string) { const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=name; document.body.append(a); a.click(); a.remove(); window.setTimeout(()=>URL.revokeObjectURL(url),1000); }
export async function exportOnboardingXlsx(onboarding:ClientOnboarding, items:ClientOnboardingItem[], client:string, signal?:AbortSignal, beforeDownload?:()=>Promise<void>) {
  const {default:ExcelJS} = await import('exceljs');
  const book = new ExcelJS.Workbook();
  const summary=book.addWorksheet('Résumé'); summary.addRow(['Champ','Valeur']);
  metadata.forEach(([label,key])=>summary.addRow([label,key==='client_nom'?client:text(onboarding[key])]));
  summary.addRow(['Éléments faits',`${items.filter(i=>i.checked).length}/${items.length}`]);
  summary.addRow(['Créé le',onboarding.created_at||'']); summary.addRow(['Mis à jour le',onboarding.updated_at||'']);
  const checklist=book.addWorksheet('Checklist'); checklist.addRow(['Section','Fait','Priorité','Statut','Élément','Notes / preuves','Action','Responsable','Échéance']);
  items.forEach(i=>checklist.addRow([i.section_title,i.checked?'Oui':'Non',i.priorite||'',i.statut||'',i.element,i.notes||'',i.action||'',i.responsable||'',i.echeance||'']));
  const recap=book.addWorksheet('Compte rendu'); recap.addRow(['Section','Contenu']); report.forEach(([label,key])=>recap.addRow([label,onboarding.compte_rendu?.[key]||'']));
  const history=book.addWorksheet('Historique'); history.addRow(['Événement','Date','Utilisateur']); (onboarding.history||[]).forEach(e=>history.addRow([e.event_type,e.created_at,e.actor_email||'']));
  for(const sheet of book.worksheets) { sheet.getRow(1).font={bold:true}; sheet.getColumn(1).width=34; for(let c=2;c<=sheet.columnCount;c++) sheet.getColumn(c).width=c===5?60:28; }
  const bytes=await book.xlsx.writeBuffer();
  signal?.throwIfAborted();
  await beforeDownload?.();
  signal?.throwIfAborted();
  download(new Blob([bytes as BlobPart],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),fileName(client,'xlsx'));
}
export async function buildOnboardingPdf(onboarding:ClientOnboarding, items:ClientOnboardingItem[], client:string) {
  const {jsPDF}=await import('jspdf');
  const pdf=new jsPDF({unit:'mm',format:'letter'}); const width=pdf.internal.pageSize.getWidth(); const height=pdf.internal.pageSize.getHeight(); const margin=16; let y=20;
  const fontResponse = await fetch(`${import.meta.env.BASE_URL}fonts/DejaVuSans.ttf`);
  if (!fontResponse.ok) throw new Error('Police PDF Unicode indisponible');
  const bytes = new Uint8Array(await fontResponse.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  pdf.addFileToVFS('DejaVuSans.ttf', btoa(binary));
  pdf.addFont('DejaVuSans.ttf', 'DejaVuSans', 'normal');
  const line=(value:unknown,heading=false)=>{ pdf.setFont('DejaVuSans','normal'); pdf.setFontSize(heading?11:9); const lines=pdf.splitTextToSize(text(value)||'-',width-margin*2); for(const part of lines){if(y>height-19){pdf.addPage();y=20;}pdf.text(part,margin,y);y+=heading?6:4.5;} y+=heading?2:1; };
  line('PRISE EN CHARGE CLIENT TI',true); line(`Client: ${client}`); line(`Progression: ${items.filter(i=>i.checked).length}/${items.length}`);
  line('Sommaire',true); metadata.forEach(([label,key])=>line(`${label}: ${key==='client_nom'?client:text(onboarding[key])}`));
  line('Compte rendu',true); report.forEach(([label,key])=>{line(label,true);line(onboarding.compte_rendu?.[key]||'-');});
  line('Checklist terrain',true); let section=''; for(const i of items){if(section!==i.section_key){section=i.section_key;line(i.section_title,true);}line(`${i.checked?'[x]':'[ ]'} ${i.element} - ${i.statut||'À faire'} / ${i.priorite||'-'}`);if(i.notes)line(`Notes: ${i.notes}`);if(i.action)line(`Action: ${i.action}`);if(i.responsable)line(`Responsable: ${i.responsable}`);if(i.echeance)line(`Échéance: ${i.echeance}`);}
  line('Historique',true); (onboarding.history||[]).forEach(e=>line(`${e.event_type} - ${e.created_at} - ${e.actor_email||''}`));
  const count=pdf.getNumberOfPages(); for(let p=1;p<=count;p++){pdf.setPage(p);pdf.setFont('DejaVuSans','normal');pdf.setFontSize(8);pdf.text(`PRIsME Prime - page ${p}/${count}`,margin,height-8);}
  return pdf;
}
export async function exportOnboardingPdf(onboarding:ClientOnboarding, items:ClientOnboardingItem[], client:string, signal?:AbortSignal, beforeDownload?:()=>Promise<void>) {
  const pdf = await buildOnboardingPdf(onboarding, items, client);
  signal?.throwIfAborted();
  await beforeDownload?.();
  signal?.throwIfAborted();
  pdf.save(fileName(client,'pdf'));
}
