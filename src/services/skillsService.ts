import {currentOnboardingSessionGeneration} from './onboardingSessionGeneration';
export class SkillsApiError extends Error {
 constructor(message:string,public status:number){super(message);this.name='SkillsApiError';}
}
export const LEVELS = ['À évaluer', 'Débutant', 'Avec accompagnement', 'Autonome', 'Référent'] as const;
export type Competence = {id:string;name:string;archived:boolean;version:number};
export type Evaluation = {primeId:number;competenceId:string;level:number|null;version:number;updatedAt:string};
export type SkillsMatrix = {specialties:{primeId:number;competenceId:string;label:string}[];competences:Competence[];evaluations:Evaluation[];primes:{id:number;nom:string;disponibilite:string;monthlyCount:number}[];canEdit:boolean;availabilityAt:string};
export async function skillsRequest<T>(path='',body?:unknown):Promise<T>{
 const generation=currentOnboardingSessionGeneration();
 const r=await fetch(`/api/skills${path}`,{credentials:'include',method:body===undefined?'GET':'PUT',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await r.json().catch(()=>null);
 if(r.status===401&&typeof window!=='undefined')window.dispatchEvent(new CustomEvent('client-onboarding:unauthorized',{detail:{generation}}));
 if(!r.ok)throw new SkillsApiError(data?.error||'Compétences indisponibles',r.status);
 if(!data||typeof data!=='object')throw new Error('Réponse de compétences invalide');
 return data as T;
}
export async function loadSkills(){
 const data=await skillsRequest<SkillsMatrix>();
 if(!Array.isArray(data.competences)||!Array.isArray(data.primes)||!Array.isArray(data.evaluations)||!Array.isArray(data.specialties)||typeof data.canEdit!=='boolean'||!Number.isFinite(Date.parse(data.availabilityAt)))throw new Error('Matrice invalide');
 const positive=(n:unknown)=>typeof n==='number'&&Number.isSafeInteger(n)&&n>0;
 if(data.competences.some(s=>!s||typeof s.id!=='string'||typeof s.name!=='string'||typeof s.archived!=='boolean'||!positive(s.version))||
 data.primes.some(p=>!p||!positive(p.id)||typeof p.nom!=='string'||typeof p.disponibilite!=='string'||!Number.isInteger(p.monthlyCount))||
 data.evaluations.some(e=>!e||!positive(e.primeId)||typeof e.competenceId!=='string'||!positive(e.version)||!(e.level===null||Number.isInteger(e.level)&&e.level>=1&&e.level<=4)||!Number.isFinite(Date.parse(e.updatedAt)))||
 data.specialties.some(s=>!s||!positive(s.primeId)||typeof s.competenceId!=='string'||typeof s.label!=='string'))throw new Error('Matrice invalide');
 return data;
}
