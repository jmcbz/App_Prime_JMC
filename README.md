# PRIsME Prime — Tour des Titans BZ

Application interne de gestion des **techniciens Prime** (responsables de clients) chez BZ.
Conçue comme une **trousse d'outils** : procédures prêtes à l'emploi et suivis de dossiers, dans l'esprit visuel **PRIsME** avec une touche **Titans de DC** (chaque Prime a son « code Titan »).

## Concept

- **Tour de contrôle** — vue d'ensemble : Primes, clients, suivis prioritaires, disponibilités, alertes.
- **Les Primes** — l'équipe : spécialités, code Titan, disponibilité, clients associés.
- **Clients** — portefeuille et Prime responsable de chacun.
- **Trousse d'outils** — procédures par catégorie (Onboarding, Incident, Maintenance, Sécurité, Reporting) avec étapes dépliables.
- **Suivis** — tableau d'opérations (à faire / en cours / bloqué / terminé) par client.

## Administration & sécurité

- **Authentification** : courriel + mot de passe (bcrypt), session JWT en cookie httpOnly.
- **MFA TOTP obligatoire pour tous** : configuration (QR code) à la première connexion, puis vérification à chaque login. Pattern éprouvé de la flotte PRIsME (otplib + secret chiffré AES-256-GCM).
- **2 rôles** : `admin` (gère tout) et `prime` (usager standard).
- **Section Administration** (admin only) : créer des usagers, changer de rôle, activer/désactiver, réinitialiser le MFA. Protection du dernier administrateur.

## Stack

- **Frontend** : React 18 · Vite 5 · TypeScript · Tailwind CSS · React Router · lucide-react.
- **Backend** (`server/`) : Express · otplib (TOTP) · bcryptjs · jsonwebtoken · qrcode. Base **SQLite en dev** (better-sqlite3) / **PostgreSQL en prod** (via `DATABASE_URL`) — même philosophie que la flotte PRIsME.
- Données métier (Primes / clients / suivis / procédures) encore **mockées** (`src/data/mock.ts`).

## Démarrer

```bash
# 1) Backend (API + auth + MFA)
cd server
npm install
cp .env.example .env     # définir au minimum JWT_SECRET
npm start                # http://127.0.0.1:4100  (crée l'admin initial au 1er boot)

# 2) Frontend (dans un autre terminal, à la racine)
npm install
npm run dev              # http://127.0.0.1:5190  (proxy /api -> 4100)
npm run build            # tsc -b && vite build
```

Au premier démarrage du backend, un **administrateur initial** est créé (`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`) — mot de passe à changer.

## Prochaines étapes

- Persister les données métier (Primes / clients / procédures / suivis) en base.
- Procédures éditables (CRUD) — **à venir**.
- Radar de maturité par technicien (façon PRIsME 6 piliers).
- Changement de mot de passe en self-service.

---

*Ébauche initiale — thème PRIsME (bz-dark/bleu/ambre) + accents Titans (cyan/violet néon).*
