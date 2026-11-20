import type {Disponibilite,StatutSuivi} from './dataService';
export interface MonthlyTask {id:string;source:'tableau'|'ancien';boardId:number;key:string|null;clientId:number|null;primeId:number|null;clientName:string;title:string;departure:string|null;due:string;status:StatutSuivi}
export interface MonthlyPrime {id:number;nom:string;manualAvailability:Disponibilite;effectiveAvailability:Disponibilite;autoCharge:boolean;monthlyCount:number}
export interface Tower {period:{key:string;start:string;end:string;last:string;today:string;timeZone:string};tasks:MonthlyTask[];primes:MonthlyPrime[];clientCount:number;riskCount:number}
export interface ToolItem {module:'onboarding'|'workstation';id:number;clientId:number;clientName:string;title:string;openedAt:string|null;href:string}
export interface Tools {recent:ToolItem[];recentHasMore:boolean;active:ToolItem[];activeTotal:number;activeHasMore:boolean;limit:number}
async function request(path:string,signal?:AbortSignal,body?:unknown) {
 const response=await fetch(path,{credentials:'include',signal,...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
 const value=await response.json();if(!response.ok)throw Error(value?.error||`Erreur ${response.status}`);return value;
}
const count=(n:unknown)=>Number.isSafeInteger(n)&&Number(n)>=0;
export async function fetchTower(signal?:AbortSignal):Promise<Tower> {
 const data=await request('/api/control-tower',signal);
 if(!data?.period||!['key','start','end','last','today','timeZone'].every(k=>typeof data.period[k]==='string')||!count(data.clientCount)||!count(data.riskCount)||!Array.isArray(data.tasks)||!Array.isArray(data.primes)||
 !data.tasks.every((t:MonthlyTask)=>t&&typeof t.id==='string'&&['tableau','ancien'].includes(t.source)&&typeof t.title==='string'&&typeof t.clientName==='string'&&typeof t.due==='string'&&(t.departure===null||typeof t.departure==='string'))||
 !data.primes.every((p:MonthlyPrime)=>p&&Number.isSafeInteger(p.id)&&typeof p.nom==='string'&&count(p.monthlyCount)&&typeof p.autoCharge==='boolean'&&['disponible','charge','surcharge'].includes(p.manualAvailability)&&['disponible','charge','surcharge'].includes(p.effectiveAvailability)))throw Error('Synthèse serveur invalide');
 return data;
}
export async function fetchTools(signal?:AbortSignal):Promise<Tools> {
 const data=await request('/api/tool-activity',signal);
 const item=(t:ToolItem)=>t&&['onboarding','workstation'].includes(t.module)&&Number.isSafeInteger(t.id)&&t.id>0&&typeof t.title==='string'&&typeof t.clientName==='string'&&(t.openedAt===null||typeof t.openedAt==='string')&&t.href===`/procedures/${t.module==='onboarding'?'prise-en-charge':'installation-postes'}?dossier=${t.id}`;
 if(!data||!Array.isArray(data.recent)||!Array.isArray(data.active)||!data.recent.every(item)||!data.active.every(item)||!count(data.activeTotal)||!count(data.limit)||typeof data.recentHasMore!=='boolean'||typeof data.activeHasMore!=='boolean')throw Error('Activité serveur invalide');return data;
}
export async function recordToolOpen(module:ToolItem['module'],id:number,userId:number,signal?:AbortSignal) {
 const result=await request('/api/tool-activity',signal,{module,id,userId});
 if(result?.recorded!==true||result.id!==id||result.module!==module)throw Error('Activité non confirmée');
}
