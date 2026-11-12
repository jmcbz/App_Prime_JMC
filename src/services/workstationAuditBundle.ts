import JSZip from 'jszip';
import { generateWorkstationAuditLauncher } from './workstationAuditScript';

/** Bundle only the authorized, freshly generated script. Reports are created at runtime.
 * Identity-only ASCII names cannot inject CMD syntax and distinguish client variants.
 */
export async function generateWorkstationAuditBundle({ clientId, templateId, scriptText }: {
  clientId: number; templateId: number; scriptText: string;
}): Promise<{ fileName: string; bytes: ArrayBuffer }> {
  if (![clientId, templateId].every(id => Number.isSafeInteger(id) && id > 0)) {
    throw new Error('Identité client/procédure invalide pour la trousse d’audit');
  }
  const stem = `audit-client-${clientId}-procedure-${templateId}`;
  const zip = new JSZip();
  // Windows PowerShell 5.1 needs the UTF-8 BOM; both native files use CRLF.
  zip.file(`${stem}.ps1`, '\uFEFF' + scriptText.replace(/\r\n|\r|\n/g, '\r\n'), { binary: false, createFolders: false });
  zip.file(`lancer-${stem}.cmd`, generateWorkstationAuditLauncher(`${stem}.ps1`), { binary: false, createFolders: false });
  const bytes = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE', platform: 'DOS' });
  return { fileName: `${stem}.zip`, bytes };
}
