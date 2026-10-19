# PRIsME Prime — Tour des Titans BZ

Application interne de gestion des **techniciens Prime** (responsables de clients) chez BZ.
Conçue comme une **trousse d'outils** : procédures prêtes à l'emploi et suivis de dossiers, dans l'esprit visuel **PRIsME** avec une touche **Titans de DC** (chaque Prime a son « code Titan »).

## Concept

- **Tour de contrôle** — vue d'ensemble : Primes, clients, suivis prioritaires, disponibilités, alertes.
- **Les Primes** — l'équipe : spécialités, code Titan, disponibilité, clients associés.
- **Clients** — portefeuille et Prime responsable de chacun.
- **Trousse d'outils** — procédures par catégorie (Onboarding, Incident, Maintenance, Sécurité, Reporting) avec étapes dépliables.
- **Suivis** — tableau d'opérations (à faire / en cours / bloqué / terminé) par client.

## Stack

React 18 · Vite 5 · TypeScript · Tailwind CSS · React Router · lucide-react.
Même socle technique que la flotte PRIsME. Données actuellement **mockées** (`src/data/mock.ts`) — backend Express + PostgreSQL à brancher ensuite.

## Démarrer

```bash
npm install
npm run dev      # http://127.0.0.1:5190
npm run build    # tsc -b && vite build
```

## Prochaines étapes

- Backend Express + PostgreSQL (persistance Primes / clients / procédures / suivis).
- Authentification BZ interne + MFA (pattern PRIsME).
- Édition des procédures et des suivis (CRUD).
- Radar de maturité par technicien (façon PRIsME 6 piliers).

---

*Ébauche initiale — thème PRIsME (bz-dark/bleu/ambre) + accents Titans (cyan/violet néon).*
