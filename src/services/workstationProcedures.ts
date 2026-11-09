import type { ClientPrime } from './dataService';

export type StepState = 'todo' | 'fait' | 'na';
export interface TemplateStep { id: string; title: string; note: string }
export interface TemplateSection { title: string; steps: TemplateStep[] }
export interface WorkstationTemplate { id: number; clientId: number | null; name: string; version: number; sections: TemplateSection[] }
export interface DossierStep extends TemplateStep { etat: StepState; commentaire: string }
export interface DossierSection { title: string; steps: DossierStep[] }
export interface WorkstationDossier {
  id: number; clientId: number; clientName: string; templateId: number; employee: string;
  computer: string; ticket: string; date: string; version: number; archivedAt: string | null;
  sections: DossierSection[];
}
export class ProcedureApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
const base = '/api/workstation-procedures';
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method, credentials: 'include',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let data: { error?: string } & T;
  try { data = text ? JSON.parse(text) : {} as T; } catch { throw new ProcedureApiError('Réponse serveur invalide', response.status); }
  if (!response.ok) throw new ProcedureApiError(data.error || `Erreur ${response.status}`, response.status);
  return data;
}
const validSections=(sections:unknown,dossier=false):sections is TemplateSection[] =>
  Array.isArray(sections) && sections.every(s => s && typeof s.title==='string' && Array.isArray(s.steps) &&
    s.steps.every((step:TemplateStep&DossierStep) => step && typeof step.id==='string' && typeof step.title==='string' &&
      typeof step.note==='string' && (!dossier || (['todo','fait','na'].includes(step.etat) && typeof step.commentaire==='string'))));
const validTemplate=(value:WorkstationTemplate)=>value&&Number.isSafeInteger(value.id)&&value.id>0&&Number.isSafeInteger(value.version)&&value.version>0&&(value.clientId===null||Number.isSafeInteger(value.clientId)&&value.clientId>0)&&typeof value.name==='string'&&validSections(value.sections);
const validDossier=(value:WorkstationDossier)=>value&&Number.isSafeInteger(value.id)&&value.id>0&&Number.isSafeInteger(value.version)&&value.version>0&&Number.isSafeInteger(value.clientId)&&value.clientId>0&&Number.isSafeInteger(value.templateId)&&value.templateId>0&&['clientName','employee','computer','ticket','date'].every(k=>typeof value[k as keyof WorkstationDossier]==='string')&&(value.archivedAt===null||typeof value.archivedAt==='string')&&validSections(value.sections,true);
const unwrap = <T extends { id: number; version: number }>(data: T | { dossier?: T; template?: T }, key: 'dossier' | 'template'): T => {
  const value = key in data ? (data as Record<string, T>)[key] : data as T;
  if (!(key==='template'?validTemplate(value as unknown as WorkstationTemplate):validDossier(value as unknown as WorkstationDossier))) throw new Error('Réponse serveur invalide : enregistrement absent');
  return value;
};
export interface ProcedurePage<T> { items: T[]; hasMore: boolean; nextBefore: number | null }
function page<T extends {id: number}>(data: Record<string, unknown>, key: string): ProcedurePage<T> {
  const items = data[key];
  if (!Array.isArray(items) || items.length>50 || !items.every(item=>key==='templates'?validTemplate(item):validDossier(item)) || typeof data.hasMore !== 'boolean' ||
    !(data.nextBefore === null || Number.isSafeInteger(data.nextBefore) && (data.nextBefore as number) > 0) ||
    (data.hasMore && (!items.length || data.nextBefore !== items.at(-1)?.id)) ||
    (!data.hasMore && data.nextBefore !== null)) throw new Error('Page serveur invalide');
  return {items, hasMore:data.hasMore, nextBefore:data.nextBefore as number | null};
}
export const listTemplates = async (before?: number) => page<WorkstationTemplate>(await request<Record<string, unknown>>(`/templates${before ? `?before=${before}` : ''}`), 'templates');
export const getStandardTemplate = async () => unwrap(await request<{template:WorkstationTemplate}>('/templates/standard'), 'template');
export const getTemplateByRequest = async (key: string) => unwrap(await request<{template:WorkstationTemplate}>(`/templates/by-request/${encodeURIComponent(key)}`), 'template');
export const createTemplate = async (body: Pick<WorkstationTemplate, 'clientId' | 'name' | 'sections'> & {requestKey:string}) => unwrap(await request<{template:WorkstationTemplate}>('/templates', 'POST', body), 'template');
export const updateTemplate = async (id: number, body: Pick<WorkstationTemplate, 'name' | 'sections'> & { expectedVersion: number }) => unwrap(await request<WorkstationTemplate | {template:WorkstationTemplate}>(`/templates/${id}`, 'PUT', body), 'template');
export const listDossiers = async (before?: number) => page<WorkstationDossier>(await request<Record<string, unknown>>(`/dossiers${before ? `?before=${before}` : ''}`), 'dossiers');
export const getDossierByRequest = async (key: string) => unwrap(await request<{dossier:WorkstationDossier}>(`/dossiers/by-request/${encodeURIComponent(key)}`), 'dossier');
export const getDossier = async (id: number) => unwrap(await request<WorkstationDossier | {dossier:WorkstationDossier}>(`/dossiers/${id}`), 'dossier');
export const createDossier = async (body: { requestKey:string; clientId: number; templateId: number; employee: string; computer: string; ticket: string; date: string }) => unwrap(await request<{dossier:WorkstationDossier}>('/dossiers', 'POST', body), 'dossier');
export const updateDossier = async (id: number, body: Pick<WorkstationDossier, 'employee' | 'computer' | 'ticket' | 'date' | 'sections'> & { expectedVersion: number }) => unwrap(await request<WorkstationDossier | {dossier:WorkstationDossier}>(`/dossiers/${id}`, 'PUT', body), 'dossier');
export const archiveDossier = async (id: number, expectedVersion: number) => unwrap(await request<WorkstationDossier | {dossier:WorkstationDossier}>(`/dossiers/${id}/archive`, 'POST', { expectedVersion }), 'dossier');
export async function listTiClients(): Promise<ClientPrime[]> {
  const response = await fetch('/api/clients', { credentials: 'include' });
  const data = await response.json();
  if (!response.ok) throw new ProcedureApiError(data.error || `Erreur ${response.status}`, response.status);
  if (!Array.isArray(data.clients)) throw new Error('Réponse des clients invalide');
  return data.clients.filter((c: ClientPrime) => c.clientType === 'ti');
}
