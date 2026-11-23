# Maîtrise de polyvalence — contrat et stockage

## Source de vérité et spécialités

- `primes.data.specialites` reste la source de vérité de l'appartenance à une spécialité et de son **libellé original**. La migration ne remplace pas ces valeurs par la grille TI.
- `prime_competences` porte l'identité stable, le nom courant, la version et l'archive du catalogue partagé. `prime_competence_aliases` associe les libellés normalisés à cette identité. Normalisation uniquement des espaces, casse et accents Unicode; aucun regroupement sémantique.
- `M365`, `Power Automate` et `Gouvernance TI` restent trois compétences distinctes. Power Automate n'est pas regroupé dans Automatisation / intégrations.
- La migration importe les spécialités existantes sans créer d'évaluation. Création/édition de Prime et sauvegarde du portefeuille mettent le catalogue à jour **dans la même transaction**. Un champ `specialites` omis conserve les valeurs existantes; `[]` explicite retire l'appartenance, pas les compétences ni leurs évaluations.
- Les liens Prime–compétence sont une projection des tags actuels via les alias, pas une deuxième liste d'appartenances à entretenir. Le DTO `specialties` contient uniquement les liens des profils autorisés, avec leurs libellés d'origine.
- Renommer une compétence conserve ses anciens alias et l'identité de ses évaluations. Les tags d'origine des fiches ne sont pas réécrits; la matrice affiche « Spécialité : libellé d'origine » sous le nom courant de la colonne. Une tentative de créer/renommer vers le libellé ou un ancien alias d'une autre compétence retourne 409.
- Modifier un tag vers un nouveau libellé non reconnu crée une nouvelle compétence, sans déplacer les anciennes évaluations. Aucune équivalence métier n'est devinée.
- L'archive est refusée tant qu'une spécialité actuelle utilise la compétence. Après retrait explicite des tags, l'archive est possible et conserve les évaluations. Réintroduire ce tag dans une fiche restaure la même compétence (avec nouvelle version), sans changer ses niveaux. Ce comportement est annoncé dans l'interface.

## Évaluations et conservation

`prime_evaluations` stocke les niveaux par identité de Prime/compétence :

- absence de ligne ou `level = NULL` : **À évaluer**, distinct d'un faible niveau;
- 1 : Débutant; 2 : Avec accompagnement; 3 : Autonome; 4 : Référent.

Aucun niveau n'est inféré des spécialités. Évaluer une compétence hors spécialité ne modifie jamais les tags. Les mises à jour contrôlent `expectedVersion`; un éditeur périmé reçoit 409. Le dernier niveau, sa version et la date ISO UTC sont conservés. Il ne s'agit pas d'un nouveau journal chronologique de toutes les anciennes notes.

Les compétences ne sont jamais supprimées par l'API (DELETE → 405); l'archive reste lisible. Les FK RESTRICT empêchent une suppression de Prime/compétence d'effacer les évaluations. Les migrations sont additives, sous les verrous et transactions d'identité App Prime existants; nouvelles colonnes/types/PK/FK sont inclus dans leur validation. Aucun changement du chiffrement MFA, des comptes ou des historiques clients/suivis.

## Droits examinés

Le commentaire historique « lecture : tout usager authentifié » de `server/index.js` ne décrit pas la portée réelle : `/api/primes` appelle `primeProfiles(req.auth)`, puis `readTower` filtre via `prime_user_links`. Cette portée, et non le commentaire, est conservée.

| Action | Admin actif avec session MFA valide | Prime standard avec session MFA valide |
|---|---|---|
| Catalogue partagé (actif/archivé) | Lecture | Lecture des noms du catalogue |
| Profils, liens de spécialités, évaluations | Tous | Uniquement le Prime explicitement lié au compte |
| Compte sans Prime lié | Vue admin | Aucun profil/évaluation; message explicite |
| Créer/renommer/archiver une compétence | Oui | 403 |
| Modifier une évaluation | Oui | 403 |
| Synthèse collective / aide à l'attribution | Oui | Non; synthèse personnelle seulement |

Les routes utilisent les gardes auth/MFA et origine existants. Rôle et activation sont relus depuis la base, pas acceptés depuis un payload ou un ancien claim JWT. Aucune liaison automatique de compte. Les changements de rôle remountent le panneau pour purger les données de l'ancien périmètre. L'aide à l'attribution ne dispose d'aucune route globale supplémentaire : elle travaille sur le DTO déjà autorisé, côté navigateur, et n'est exposée qu'à l'admin.

## Interface et attribution

### Cohérence de session pendant les attentes

Les routes skills revalident la session complète **après** acquisition du verrou métier : identité, activation, rôle actuel, version du facteur MFA, objet `session` et expiration. La politique est partagée avec le middleware, qui vérifie toujours la signature JWT. Sous PostgreSQL, l'ordre est verrou métier → ligne utilisateur `FOR SHARE` → ligne MFA `FOR SHARE`, conservés jusqu'au commit; les mutations d'identité/MFA existantes attendent ces verrous. Sous SQLite, la transaction `BEGIN IMMEDIATE` et son propriétaire exclusif interdisent un écrivain concurrent. Matrice, portée, `canEdit` et profils/disponibilité sont composés dans cette même transaction, sans deuxième lecture avec des claims périmés.

Le logout existant efface le cookie, sans registre de révocation des JWT : une requête déjà authentifiée peut terminer après cette suppression. Ce contrat est conservé et testé pour GET/PUT; les requêtes ultérieures sans cookie sont refusées. La désactivation, la réinitialisation/réinscription MFA et l'expiration invalident en revanche les requêtes en attente. Aucun nouveau système de session n'est introduit.

Dans Les Primes / Mon Prime : onglet Maîtrise de polyvalence, lignes Primes, colonnes compétences, filtres Prime/compétence/niveau, archive consultable, synthèse des forces, formation/accompagnement, compétences sans autonome **évalué**, dépendance à une seule personne évaluée et nombre de profils à évaluer.

L'aide à l'attribution sélectionne temporairement les compétences et niveaux minimum du besoin client/projet. Elle affiche chaque exigence couverte, écart ou couverture inconnue pour tous les profils, dans l'ordre existant, sans classement opaque ni attribution automatique. Aucun nouveau registre clients/projets. La disponibilité actuelle et le nombre de tâches du mois proviennent du calcul métier existant et restent séparés du niveau.

Chaque choix de niveau s'enregistre immédiatement; sauvegarde puis GET exact avant confirmation. En cas d'échec ou de résultat incertain, erreur visible et nouvelle écriture bloquée jusqu'à relecture. Pas de persistance métier localStorage/sessionStorage. Le tableau défile horizontalement dans son propre conteneur sur mobile; shell/logo PRIME conservés.

Toutes les lectures et mutations partagent une révision de requête : une ancienne réponse ne peut remplacer une sauvegarde relue. Les brouillons de catalogue sont protégés aux onglets parents, liens du shell, historique Retour/Avance, rechargement et déconnexion. Un abandon nécessite confirmation; une écriture en cours/incertaine doit d'abord être relue. Les rejets de validation/doublon 400/409 restent corrigeables, sans perte de saisie au rafraîchissement. Une réponse perdue est réconciliée par le même identifiant : contenu confirmé → fermeture avec confirmation; absence → reprise avec identifiant conservé; version concurrente → comparaison explicite puis accord avant reprise sur cette version. Une revalidation confirmant une autre identité ou un autre rôle purge toujours l'ancien panneau.

## Bornes explicites

100 profils par matrice autorisée, 100 compétences (archives comprises), 100 spécialités par profil, 100 caractères par libellé, 1000 alias historiques et réponse 2 Mio maximum. Aucun résultat présenté comme complet n'est tronqué. Dépassement lecture → 413; capacité d'écriture → 409 avec rollback, payload invalide → 400. Une ancienne base hors de ces bornes peut nécessiter une décision de capacité avant migration; aucun nettoyage automatique ni perte de données pour la faire entrer dans les limites.

## Vérification du candidat

Base de départ : `9b3cecd8bc6e68703a0db0c53a2be67585ff826a`, arbre `b49bc8b3d0fba280d8adb8a003d3fb3a404614a2`.

Tests versionnés : `server/skills-http.test.mjs`, `server/skills-migration.test.mjs`, `server/skills-auth-race.test.mjs`, `src/services/skillsService.test.mjs`, `scripts/skills-browser-regression.py`. Les tests DB refusent l'exécution sans le harnais isolé. Le test migration utilise une archive exacte du parent sous `/evidence/baseline`. La régression navigateur utilise le vrai dist, PostgreSQL et le seed de fixture `/evidence/seed-browser.mjs`, avec le Python/Chromium explicitement montés par le harnais; elle ne synthétise aucune réponse métier.

Harnais et preuves de cette session : `/root/.hermes/cache/scratch/prime-skills-evidence/` (`run-isolated.py`, `pg.sh`, `browser.py`, logs `ci-*`, captures PNG). Environnement vide, namespaces réseau/montage/PID, chroot dont PID 1 est lui-même enfermé, procfs local, réseau loopback seulement, fichiers explicitement montés sans dotenv, PostgreSQL jetable par socket dans le tmpfs; SQLite jetable séparé. Les comptes/cookies sont des fixtures locales, pas une session de production.

Exemples de commandes depuis l'hôte :

```sh
python /root/.hermes/cache/scratch/prime-skills-evidence/run-isolated.py node --test server/skills-http.test.mjs
python /root/.hermes/cache/scratch/prime-skills-evidence/run-isolated.py sh /evidence/pg.sh node --test server/skills-http.test.mjs
python /root/.hermes/cache/scratch/prime-skills-evidence/run-isolated.py node --test server/skills-migration.test.mjs
python /root/.hermes/cache/scratch/prime-skills-evidence/run-isolated.py sh /evidence/pg.sh node --test server/skills-migration.test.mjs
python /root/.hermes/cache/scratch/prime-skills-evidence/run-isolated.py env NODE_ENV=production npm run build
python /root/.hermes/cache/scratch/prime-skills-evidence/run-isolated.py sh /evidence/pg.sh /python/bin/python /evidence/browser.py
python /root/.hermes/cache/scratch/prime-skills-evidence/run-isolated.py sh /evidence/pg.sh node --test server/skills-auth-race.test.mjs
python /root/.hermes/cache/scratch/prime-skills-evidence/run-isolated.py sh /evidence/pg.sh /python/bin/python scripts/skills-browser-regression.py
```

Les preuves incluent migration d'une base peuplée avec conservation exacte des huit tables métier/auth testées, refus d'identité étrangère/FK absente, CRUD et routes directes des deux rôles, champs invalides, concurrence CAS et attente réelle du verrou PostgreSQL, capacité/rollback, liaison des trois spécialités, variantes casse/accents, retrait/renommage/restauration, vrais clics sur dist production avec PostgreSQL, GET après sauvegarde/rechargement, panne réseau, largeurs 390/1280/1867 et rétrogradation admin→Prime du même compte.

Aucun commit/push ni vérification métier connectée de production dans ce candidat. La contre-revue indépendante appartient au parent avant publication.
