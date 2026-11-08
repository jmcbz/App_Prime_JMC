import { currentOnboardingSessionGeneration } from './onboardingSessionGeneration.ts';

export type ClientOnboardingStatus = 'À faire' | 'En cours' | 'Bloqué' | 'Fait' | 'N/A';
export type ClientOnboardingPriority = 'Critique' | 'Haute' | 'Moyenne' | 'Basse' | '';

export interface ClientOnboardingItem {
  id?: number;
  onboarding_id?: number;
  section_key: string;
  section_title: string;
  item_order: number;
  checked: boolean;
  priorite?: ClientOnboardingPriority;
  statut?: ClientOnboardingStatus | '';
  element: string;
  notes?: string;
  action?: string;
  responsable?: string;
  echeance?: string | null;
}

export interface ClientOnboarding {
  id?: number;
  version?: number;
  client_id: number | '';
  technicien_id?: number | '';
  titre: string;
  statut: ClientOnboardingStatus;
  priorite: Exclude<ClientOnboardingPriority, ''>;
  urgence_ti?: string;
  site_principal?: string;
  contact_principal?: string;
  periode_couverte?: string;
  prepare_pour?: string;
  avancement_global?: string;
  risques_critiques?: string;
  actions_ouvertes?: string;
  decisions_requises?: string;
  prochaine_rencontre?: string;
  compte_rendu?: {
    resume_executif?: string;
    points_valides?: string;
    points_a_corriger?: string;
    recommandations_prioritaires?: string;
    prochaines_etapes?: string;
  };
  client_nom?: string;
  technicien_nom?: string;
  technicien_email?: string;
  total_items?: number;
  completed_items?: number;
  high_priority_open_items?: number;
  created_at?: string;
  updated_at?: string;
  archived?: boolean;
  archived_at?: string | null;
  items?: ClientOnboardingItem[];
  history?: ClientOnboardingHistory[];
}

export interface ClientOnboardingHistory {
  id: number;
  onboarding_id: number;
  event_type: string;
  actor_email?: string;
  created_at: string;
  snapshot?: Record<string, unknown>;
}

export const onboardingStatuses: ClientOnboardingStatus[] = ['À faire', 'En cours', 'Bloqué', 'Fait', 'N/A'];
export const onboardingPriorities: Exclude<ClientOnboardingPriority, ''>[] = ['Critique', 'Haute', 'Moyenne', 'Basse'];

export const CLIENT_ONBOARDING_TEMPLATE: Array<{ key: string; title: string; items: string[] }> = [
  {
    key: 'informations-generales',
    title: 'Informations générales du client',
    items: [
      'Nom légal de l’entreprise',
      'Nom commercial',
      'Adresse principale',
      'Personnes contacts',
      'Contact décisionnel',
      'Contact urgence TI',
      'Heures d’ouverture',
      'Sites physiques / succursales',
      'Nombre d’utilisateurs',
      'Nombre de postes',
      'Nombre de serveurs',
      'Domaine principal',
      'Fournisseurs TI actuels',
    ],
  },
  {
    key: 'acces-comptes-admin',
    title: 'Accès et comptes administratifs',
    items: [
      'Obtenir les accès administratifs existants',
      'Identifier les comptes privilégiés',
      'Changer / sécuriser les mots de passe critiques',
      'Activer MFA sur tous les comptes administrateurs',
      'Créer un compte admin dédié pour l’équipe TI',
      'Documenter les accès dans le gestionnaire de mots de passe',
      'Vérifier les accès Microsoft 365',
      'Vérifier les accès registrar DNS',
      'Vérifier les accès hébergement web',
      'Vérifier les accès pare-feu / réseau',
      'Vérifier les accès serveurs / NAS / sauvegardes',
      'Vérifier les accès antivirus / EDR',
      'Vérifier les accès téléphonie / fournisseur Internet',
    ],
  },
  {
    key: 'inventaire-actifs-ti',
    title: 'Inventaire des actifs TI',
    items: [
      'Postes de travail',
      'Portables',
      'Serveurs physiques',
      'Serveurs virtuels',
      'NAS / stockage',
      'Imprimantes',
      'Switchs',
      'Pare-feu / routeurs',
      'Points d’accès Wi-Fi',
      'Téléphones IP',
      'Licences logicielles',
      'Équipements hors garantie',
      'Équipements critiques',
      'Numéros de série',
      'Dates d’achat si disponibles',
      'Garantie / support actif',
    ],
  },
  {
    key: 'microsoft-365',
    title: 'Microsoft 365 / Tenant',
    items: [
      'Prendre contrôle du tenant Microsoft 365',
      'Vérifier les rôles administrateurs',
      'Vérifier les domaines validés',
      'Vérifier MFA / Conditional Access',
      'Vérifier les licences',
      'Vérifier comptes inactifs / invités',
      'Vérifier groupes / boîtes partagées',
      'Vérifier Exchange / SPF / DKIM / DMARC',
      'Vérifier SharePoint / OneDrive',
      'Vérifier Teams',
      'Vérifier politiques de sécurité',
      'Vérifier sauvegarde M365 si applicable',
    ],
  },
  {
    key: 'securite',
    title: 'Sécurité',
    items: [
      'Vérifier antivirus / EDR',
      'Vérifier MFA',
      'Vérifier comptes administrateurs',
      'Vérifier pare-feu',
      'Vérifier mises à jour critiques',
      'Vérifier politiques de mots de passe',
      'Vérifier sauvegardes protégées',
      'Vérifier alertes de sécurité',
      'Vérifier accès distant / VPN / RDP',
      'Identifier risques critiques immédiats',
    ],
  },
  {
    key: 'sauvegardes-continuite',
    title: 'Sauvegardes / continuité',
    items: [
      'Identifier solution de sauvegarde',
      'Vérifier derniers backups',
      'Vérifier erreurs récentes',
      'Vérifier couverture serveurs / postes / M365',
      'Vérifier rétention',
      'Vérifier sauvegardes hors site / immuables',
      'Tester restauration',
      'Documenter RPO / RTO',
      'Documenter procédure de restauration',
      'Identifier données critiques non sauvegardées',
    ],
  },
  {
    key: 'reseau-internet-wifi',
    title: 'Réseau / Internet / Wi-Fi',
    items: [
      'Documenter topologie réseau',
      'Vérifier pare-feu / routeur principal',
      'Vérifier switches',
      'Vérifier VLAN',
      'Vérifier Wi-Fi',
      'Vérifier firmware des équipements critiques',
      'Documenter accès fournisseur Internet',
      'Documenter IP publique',
      'Vérifier règles NAT / port forwarding',
      'Vérifier VPN site-à-site ou client VPN',
    ],
  },
  {
    key: 'postes-gestion',
    title: 'Postes et gestion',
    items: [
      'Vérifier domaine AD ou Azure AD / Entra ID',
      'Vérifier Intune / GPO / RMM',
      'Installer agent RMM si applicable',
      'Installer agent antivirus / EDR',
      'Vérifier droits admin locaux',
      'Vérifier standardisation des postes',
      'Vérifier logiciels métier installés',
      'Vérifier imprimantes déployées',
      'Vérifier mises à jour OS',
      'Vérifier chiffrement disque',
    ],
  },
  {
    key: 'applications-metier',
    title: 'Applications métier',
    items: [
      'Liste des applications critiques',
      'Fournisseurs / contacts support',
      'Type d’installation : local / cloud / serveur / SaaS',
      'Comptes administrateurs',
      'Méthode de sauvegarde',
      'Procédure de restauration',
      'Dépendances réseau / serveur',
      'Licences',
      'Contrats de support',
    ],
  },
  {
    key: 'documentation',
    title: 'Documentation',
    items: [
      'Créer fiche client',
      'Créer schéma réseau',
      'Documenter les accès',
      'Documenter procédures importantes',
      'Documenter licences',
      'Documenter fournisseurs',
      'Documenter contrats',
      'Documenter garanties',
      'Documenter architecture M365',
      'Documenter sauvegardes',
      'Documenter risques connus',
      'Documenter actions urgentes recommandées',
    ],
  },
  {
    key: 'priorites-apres-audit',
    title: 'Priorités après audit',
    items: [
      'Risques critiques à corriger immédiatement',
      'Correctifs sécurité rapides',
      'Nettoyage des accès',
      'Normalisation des licences',
      'Mise en place sauvegardes fiables',
      'Plan de migration / amélioration',
      'Recommandations au client',
      'Rapport initial de prise en charge',
    ],
  },
];

export function createTemplateItems(): ClientOnboardingItem[] {
  return CLIENT_ONBOARDING_TEMPLATE.flatMap((section, sectionIndex) =>
    section.items.map((element, itemIndex) => ({
      section_key: section.key,
      section_title: section.title,
      item_order: sectionIndex * 100 + itemIndex,
      checked: false,
      priorite: '',
      statut: 'À faire',
      element,
      notes: '',
      action: '',
      responsable: '',
      echeance: null,
    })),
  );
}


export interface OnboardingOptions { clients: {id: number; nom: string}[]; techniciens: {id: number; prenom: string; nom: string; email: string}[] }

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const generation = currentOnboardingSessionGeneration();
  const response = await fetch(`/api/client-onboardings${path}`, {
    ...init, credentials: 'include',
    headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  });
  if (response.status === 401) {
    window.dispatchEvent(new window.CustomEvent('client-onboarding:unauthorized', {detail: {generation}}));
    throw new Error('Session expirée');
  }
  const raw = await response.text();
  let data: any;
  try { data = raw ? JSON.parse(raw) : {}; } catch { throw new Error(`Réponse serveur invalide (${response.status})`); }
  if (!response.ok) throw new Error(data.error || `Erreur API (${response.status})`);
  return data as T;
}
export const getOnboardingOptions = () => request<OnboardingOptions>('/options');
export async function listClientOnboardings(filters: Record<string, string | number | boolean | undefined> = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => { if (value !== undefined && String(value).trim() !== '') params.set(key, String(value)); });
  const rows: ClientOnboarding[] = [];
  let before: number | undefined;
  for (let pageIndex = 0; pageIndex < 200; pageIndex++) {
    if (before !== undefined) params.set('before', String(before));
    const page = await request<ClientOnboarding[]>(`?${params.toString()}`);
    if (!Array.isArray(page)) throw new Error('Pagination du registre invalide');
    if (page.length > 50 || (page.length && (!Number.isSafeInteger(page.at(-1)?.id) || (before !== undefined && page.at(-1)!.id! >= before)))) throw new Error('Pagination du registre invalide');
    rows.push(...page);
    if (page.length < 50) return rows;
    before = page.at(-1)!.id;
  }
  throw new Error('Registre trop volumineux : pagination incomplète');
}
export const getClientOnboarding = (id: number, signal?: AbortSignal) => request<ClientOnboarding>(`/${id}`, {signal});
export interface OnboardingHistoryPage { history: ClientOnboardingHistory[]; hasMore: boolean; nextBefore: number | null; events?: ClientOnboardingHistory[] }
export function getClientOnboardingHistory(id: number, before?: number, limit = 50, signal?: AbortSignal) {
  const params = new URLSearchParams({limit: String(limit)});
  if (before !== undefined) params.set('before', String(before));
  return request<OnboardingHistoryPage>(`/${id}/history?${params}`, {signal});
}
export async function getCompleteOnboardingHistory(id: number, signal?: AbortSignal): Promise<ClientOnboardingHistory[]> {
  const events: ClientOnboardingHistory[] = [];
  let before: number | undefined;
  for (let pageIndex = 0; pageIndex < 200; pageIndex++) {
    signal?.throwIfAborted();
    const page = await getClientOnboardingHistory(id, before, 100, signal);
    signal?.throwIfAborted();
    const batch = page.events ?? page.history;
    if (!Array.isArray(batch) || batch.length > 100) throw new Error('Pagination de l’historique invalide');
    events.push(...batch);
    if (page.nextBefore == null) {
      if (page.hasMore) throw new Error('Pagination de l’historique invalide');
      return events;
    }
    if (!Number.isSafeInteger(page.nextBefore) || page.nextBefore <= 0 || (before !== undefined && page.nextBefore >= before) || !batch.length || batch.at(-1)?.id !== page.nextBefore) throw new Error('Pagination de l’historique invalide');
    before = page.nextBefore;
  }
  throw new Error('Historique trop volumineux : export annulé (pagination incomplète)');
}
export async function createClientOnboarding(onboarding: ClientOnboarding, items: ClientOnboardingItem[], requestKey: string): Promise<ClientOnboarding> {
  const saved = await request<unknown>('', {method:'POST', body: JSON.stringify({onboarding,items,requestKey})});
  if (!saved || typeof saved !== 'object' ||
      !Number.isSafeInteger((saved as ClientOnboarding).id) || (saved as ClientOnboarding).id! <= 0 ||
      !Number.isSafeInteger((saved as ClientOnboarding).version) || (saved as ClientOnboarding).version! <= 0 ||
      !Number.isSafeInteger((saved as ClientOnboarding).client_id) || Number((saved as ClientOnboarding).client_id) <= 0 ||
      (saved as ClientOnboarding).client_id !== onboarding.client_id ||
      !Array.isArray((saved as ClientOnboarding).items) ||
      !(saved as ClientOnboarding).items!.every(item => item && typeof item === 'object' && !Array.isArray(item) &&
        typeof item.section_key === 'string' && item.section_key.trim() !== '' &&
        typeof item.section_title === 'string' && item.section_title.trim() !== '' &&
        typeof item.element === 'string' && item.element.trim() !== '' &&
        Number.isSafeInteger(item.item_order) && item.item_order >= 0 &&
        typeof item.checked === 'boolean')) throw new Error('Réponse de création invalide');
  return saved as ClientOnboarding;
}
export type OnboardingReconciliation = {found: false} | {found: true; id: number; archived: boolean};
export const reconcileClientOnboarding = (requestKey: string) => request<OnboardingReconciliation>(`/reconcile?${new URLSearchParams({requestKey})}`);
export const updateClientOnboarding = (id: number, onboarding: ClientOnboarding, items: ClientOnboardingItem[], expectedVersion: number) => request<ClientOnboarding>(`/${id}`, {method:'PUT', body: JSON.stringify({onboarding,items,expectedVersion})});
export const archiveClientOnboarding = (id: number, expectedVersion: number) => request<{success: boolean}>(`/${id}`, {method:'DELETE', body: JSON.stringify({expectedVersion})});
export const restoreClientOnboarding = (id: number, expectedVersion: number) => request<ClientOnboarding>(`/${id}/restore`, {method:'POST', body: JSON.stringify({expectedVersion})});
