// Données de démonstration — PRIsME Prime (Tour des Titans BZ)
// Remplacées à terme par l'API BZ. Aucune donnée réelle sensible ici.

export type Disponibilite = 'disponible' | 'charge' | 'surcharge';

export interface Prime {
  id: number;
  nom: string;
  codeTitan: string;      // nom de code "Titan" (clin d'œil subtil)
  specialites: string[];
  disponibilite: Disponibilite;
  clientsIds: number[];
  avatarInitiales: string;
}

export interface ClientPrime {
  id: number;
  nom: string;
  secteur: string;
  primeId: number;        // Prime (responsable) associé
  statut: 'actif' | 'onboarding' | 'risque';
}

export type CategorieProcedure = 'Onboarding' | 'Incident' | 'Maintenance' | 'Sécurité' | 'Reporting';

export interface Procedure {
  id: number;
  titre: string;
  categorie: CategorieProcedure;
  resume: string;
  etapes: string[];
  tempsEstime: string;
}

export type StatutSuivi = 'a_faire' | 'en_cours' | 'termine' | 'bloque';

export interface Suivi {
  id: number;
  titre: string;
  clientId: number;
  primeId: number;
  statut: StatutSuivi;
  echeance: string;        // ISO date
  note?: string;
}

export const PRIMES: Prime[] = [
  { id: 1, nom: 'Jean-Michel Caouette', codeTitan: 'Nightwing', specialites: ['M365', 'Power Automate', 'Gouvernance TI'], disponibilite: 'charge', clientsIds: [1, 2], avatarInitiales: 'JM' },
  { id: 2, nom: 'Alexane Morin', codeTitan: 'Starfire', specialites: ['Réseau', 'Sécurité', 'FortiGate'], disponibilite: 'disponible', clientsIds: [3], avatarInitiales: 'AM' },
  { id: 3, nom: 'Carl Thibault', codeTitan: 'Cyborg', specialites: ['Infra serveur', 'SharePoint', 'Migration'], disponibilite: 'surcharge', clientsIds: [4, 5], avatarInitiales: 'CT' },
  { id: 4, nom: 'Maude Girard', codeTitan: 'Raven', specialites: ['Sauvegardes', 'Continuité', 'Audit'], disponibilite: 'disponible', clientsIds: [6], avatarInitiales: 'MG' },
];

export const CLIENTS: ClientPrime[] = [
  { id: 1, nom: 'Coopérative funéraire des Deux Rives', secteur: 'Services funéraires', primeId: 1, statut: 'actif' },
  { id: 2, nom: 'Ville de Saint-Lin-Laurentides', secteur: 'Municipal', primeId: 1, statut: 'actif' },
  { id: 3, nom: 'COEFICIA CPA', secteur: 'Comptabilité / CPA', primeId: 2, statut: 'actif' },
  { id: 4, nom: 'Chabot Carrosserie', secteur: 'Automobile', primeId: 3, statut: 'risque' },
  { id: 5, nom: 'Ambioner', secteur: 'Ingénierie-conseil', primeId: 3, statut: 'onboarding' },
  { id: 6, nom: 'APE – Services d’aide à l’emploi', secteur: 'OBNL / Emploi', primeId: 4, statut: 'actif' },
];

export const PROCEDURES: Procedure[] = [
  {
    id: 1, titre: 'Onboarding d’un nouveau client', categorie: 'Onboarding', tempsEstime: '2–3 h',
    resume: 'Mise en place initiale d’un client : accès, inventaire, documentation de départ.',
    etapes: [
      'Créer la fiche client dans PRIsME et assigner le Prime responsable.',
      'Collecter les accès (M365, réseau, serveurs) et les consigner dans le coffre.',
      'Dresser l’inventaire des actifs TI et des parties prenantes.',
      'Planifier la prise de besoin et la première rencontre de gouvernance.',
    ],
  },
  {
    id: 2, titre: 'Traitement d’un incident critique', categorie: 'Incident', tempsEstime: 'Variable',
    resume: 'Procédure de réponse à un incident majeur (panne, sécurité, perte de données).',
    etapes: [
      'Qualifier la sévérité et ouvrir le billet avec horodatage.',
      'Confiner / isoler si incident de sécurité ; prévenir le client.',
      'Appliquer le correctif ou le contournement, documenter chaque action.',
      'Rédiger le post-mortem et les mesures préventives.',
    ],
  },
  {
    id: 3, titre: 'Vérification mensuelle des sauvegardes', categorie: 'Maintenance', tempsEstime: '45 min',
    resume: 'Contrôle de l’intégrité et de la restaurabilité des sauvegardes client.',
    etapes: [
      'Vérifier le succès des derniers jobs de sauvegarde.',
      'Effectuer un test de restauration ciblé.',
      'Consigner le résultat dans le suivi client.',
    ],
  },
  {
    id: 4, titre: 'Revue de posture sécurité', categorie: 'Sécurité', tempsEstime: '1–2 h',
    resume: 'Évaluation périodique de la sécurité (MFA, correctifs, droits d’accès).',
    etapes: [
      'Confirmer l’activation du MFA pour tous les comptes.',
      'Vérifier l’état des correctifs et des antivirus.',
      'Réviser les droits d’accès et retirer les comptes inactifs.',
    ],
  },
  {
    id: 5, titre: 'Rapport trimestriel au client', categorie: 'Reporting', tempsEstime: '1 h',
    resume: 'Préparation du bilan trimestriel : incidents, projets, recommandations.',
    etapes: [
      'Compiler les métriques du trimestre (tickets, disponibilité).',
      'Mettre à jour le radar de maturité TI.',
      'Préparer les recommandations et le plan du prochain trimestre.',
    ],
  },
];

export const SUIVIS: Suivi[] = [
  { id: 1, titre: 'Migration SharePoint — phase pilote', clientId: 5, primeId: 3, statut: 'en_cours', echeance: '2026-11-15', note: 'Compagnie pilote du groupe.' },
  { id: 2, titre: 'Test de restauration sauvegardes', clientId: 1, primeId: 1, statut: 'a_faire', echeance: '2026-10-31' },
  { id: 3, titre: 'Activation MFA tous comptes', clientId: 4, primeId: 3, statut: 'bloque', echeance: '2026-10-25', note: 'En attente d’accès admin client.' },
  { id: 4, titre: 'Prise de besoin initiale', clientId: 3, primeId: 2, statut: 'termine', echeance: '2026-10-10' },
  { id: 5, titre: 'Rapport trimestriel Q4', clientId: 6, primeId: 4, statut: 'a_faire', echeance: '2026-12-15' },
  { id: 6, titre: 'Revue posture sécurité', clientId: 2, primeId: 1, statut: 'en_cours', echeance: '2026-11-05' },
];
