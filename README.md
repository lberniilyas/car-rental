# Kiraa — Agent Intelligent de Location de Véhicules

Agent agentique full-stack TypeScript : ingestion multi-format, extraction structurée,
orchestration LangGraph.js, moteur déterministe, RAG vectoriel PostgreSQL/pgvector,
interface Next.js et exécution conteneurisée.

> **Axiome Zéro-Hallucination** — Le code TypeScript calcule et valide de manière
> déterministe. Le LLM orchestre, extrait et explique en langage naturel. Aucun calcul
> mathématique ni décision réglementaire n'est délégué au modèle de langage.

---

## 1. Démarrage rapide (évaluation locale)

Prérequis : **Docker Desktop** et **Docker Compose**. Rien d'autre — pas d'installation
PostgreSQL manuelle, pas de Node.js requis sur la machine hôte.

```bash
# 1. Configurer l'environnement
cp .env.example .env.local
#    puis renseigner LLM_API_KEY dans .env.local

# 2. Démarrer l'application et la base
docker compose up -d

# 3. Appliquer les migrations, charger les données et indexer le corpus RAG
#    Ces scripts s'exécutent depuis l'hôte et visent la base publiée sur le port 5433.
#    Node.js 20+ est requis pour cette étape uniquement.
npm install
npm run db:migrate     # crée l'extension pgvector puis applique les migrations
npm run db:seed        # charge les CSV (idempotent, non destructif)
npm run rag:index      # fragmente et vectorise data/rental_policies.md

# 4. Ouvrir l'interface
#    http://localhost:3000
```

> Les scripts `db:migrate`, `db:seed` et `rag:index` sont **déclenchés manuellement**
> (et non automatiquement au démarrage), afin que le chargement initial reste
> vérifiable et qu'aucune écriture involontaire ne survienne sur un environnement
> distant. Ils sont **idempotents** : les relancer ne duplique ni ne supprime rien.

### Ports et URLs

| Service | Port hôte | URL | Remarque |
|---|---|---|---|
| Application Next.js | 3000 | http://localhost:3000 | interface et API |
| Healthcheck | 3000 | http://localhost:3000/api/health | app + PostgreSQL |
| Exécution de l'agent | 3000 | `POST http://localhost:3000/api/chat` | multipart/form-data |
| PostgreSQL + pgvector | **5433** | `postgresql://kiraa:…@localhost:5433/kiraa` | 5433 pour éviter tout conflit avec une installation PostgreSQL native sur 5432 |

---

## 2. Tests

```bash
npm test          # suite complète (33 tests)
npm run test:unit # moteur déterministe + ingestion
npm run test:e2e  # les 5 scénarios du cahier des charges
npm run typecheck # vérification TypeScript stricte
```

| Suite | Contenu |
|---|---|
| `tests/unit/engine.test.ts` | 14 assertions de **parité** avec le notebook Python de référence |
| `tests/unit/ingestor.test.ts` | ingestion réelle des fichiers de `samples/`, OCR tesseract réel |
| `tests/e2e/scenarios.test.ts` | les 5 scénarios, exécutés à travers le **vrai** graphe LangGraph.js |

Les tests E2E vérifient l'état partagé persistant : `bookingStatus`, `needsHumanReview`,
`escalationReasons`, montant de la caution, plafond de remise, présence des passages RAG
et **absence de calcul** pour une question de politique.

---

## 3. Architecture

### Les 7 couches agentiques

| Couche | Module | Responsabilité |
|---|---|---|
| 1 Ingestor | `lib/ingestor/` | normalise messages, images, PDF, JSON, TXT |
| 2 Extractor | `lib/schemas/extraction.ts` | extraction validée par Zod, état typé |
| 3 Orchestrator | `lib/agent/graph.ts` | `StateGraph`, routage, escalade, checkpoints |
| 4 Calculator | `lib/engine/` | formules déterministes, **zéro appel LLM** |
| 5 Validator | `lib/agent/nodes.ts` | règles booléennes, résultat validé par Zod |
| 6 Explainer | `lib/agent/nodes.ts` | explication en lecture seule de l'état |
| 7 Reporter | `lib/reporter/pdf.ts` | devis PDF à partir des seules valeurs validées |

### Topologie du graphe

```
START → ingestor → extractor → intent → ┬─ policy_query ─────→ calculator (RAG seul)
                                        ├─ out_of_scope ─────→ explainer
                                        ├─ human_escalation ─→ explainer
                                        └─ autres ───────────→ validator
                                                                  ├─ éligibilité seule → explainer
                                                                  ├─ rejet/clarification → explainer
                                                                  └─ sinon → calculator
                                        … → explainer → reporter → END
```

Le chemin réellement emprunté est journalisé dans `graphTrace` et affiché dans l'interface.

### Séparation des responsabilités

- **PostgreSQL relationnel** — flotte, clients, réservations, grille saisonnière :
  disponibilité, éligibilité et calculs financiers.
- **RAG pgvector** — `data/rental_policies.md` **uniquement** : annulation, franchise,
  assurance, kilométrage. Ni le cahier des charges ni le notebook ne servent de corpus.

---

## 4. Moteur déterministe

```
Total = (Prix_Base × Jours × Coefficient_Saisonnier) + Assurance + Caution − Remise_Plafonnée
Total = max(Total, Caution)
```

- Remise **strictement plafonnée à 15 %**, quel que soit le taux nominal du code.
- Caution **majorée de 50 %** pour les conducteurs de moins de 25 ans.
- Éligibilité : âge ≥ 21 ans **et** ancienneté du permis ≥ 2 ans ; permis expiré = rejet bloquant.

Les constantes (cautions par catégorie, options d'assurance, codes de remise, tarif du
kilomètre supplémentaire) sont portées **verbatim** depuis le notebook, dans
`lib/engine/constants.ts`.

> **Note de parité** : `lib/engine/dates.ts` implémente `roundPy()`, qui reproduit
> l'arrondi au pair le plus proche de Python (`round()`), et non l'arrondi commercial de
> JavaScript. Sans cela, certains montants divergeraient de la référence.

### Seuils d'escalade humaine (HITL)

- Confiance d'extraction OCR < **0,85**
- Jeune conducteur (21–24 ans) sur un véhicule **Premium**
- Caution requise > **20 000 MAD**
- Conflit entre formulaire, document extrait et message utilisateur

---

## 5. Contrôles Zero-Trust

| Situation | Comportement |
|---|---|
| Fichier hors sujet ou corrompu | rejet, demande d'un nouveau fichier |
| Champ obligatoire absent | `CLARIFICATION_REQUIRED` — **jamais** de valeur inventée |
| Date ambiguë | demande de clarification |
| Conflit formulaire / document / message | confirmation humaine requise |
| Extraction sous le seuil de confiance | revue humaine |

---

## 6. Ingestion multi-format

| Format | Moteur | Comportement |
|---|---|---|
| JPG / JPEG / PNG | `tesseract.js` | OCR, score de confiance normalisé |
| PDF | `pdf-parse` → OCR | **extraction native d'abord** ; bascule OCR si le texte est insuffisant |
| JSON | parseur + Zod | validation structurelle |
| TXT | lecture directe | — |

Pour chaque fichier, l'interface affiche : nom, type, statut de validation, moteur
utilisé, contenu extrait, score de confiance, erreurs et statut de revue humaine.

### Limites connues

- **Rasterisation PDF non implémentée.** `tesseract.js` ne sait pas lire un PDF : il
  attend une image matricielle. Un PDF **sans texte natif exploitable** est donc placé en
  `CLARIFICATION_REQUIRED` avec un message explicite, au lieu d'être envoyé à un OCR qui
  échouerait. Les PDF contenant du texte (cas courant) sont traités nativement.
  Un OCR alternatif capable de lire un PDF peut être injecté via `IngestOptions.ocr`.
- **PDF à table XRef malformée.** `pdf.js` peut échouer au premier appel d'un processus ;
  `extractPdfNative()` réessaie jusqu'à 4 fois, ce qui couvre le cas observé sur
  `samples/sample_test_document.pdf`.

---

## 7. Variables d'environnement

Copier `.env.example` vers `.env.local` (ignoré par git) et renseigner les valeurs.
**Aucun secret n'est présent dans le dépôt.**

| Variable | Rôle | Défaut |
|---|---|---|
| `DATABASE_URL` | connexion PostgreSQL | `postgresql://kiraa:…@localhost:5433/kiraa` |
| `LLM_PROVIDER` | fournisseur LLM | `groq` |
| `LLM_API_KEY` | clé API LLM — **obligatoire** | _(vide)_ |
| `LLM_MODEL` | modèle de langage | `qwen/qwen3.8-27b` |
| `EMBEDDINGS_PROVIDER` | fournisseur d'embeddings | `local` |
| `EMBEDDINGS_MODEL` | modèle d'embeddings | `Xenova/all-MiniLM-L6-v2` |
| `EMBEDDINGS_DIMENSION` | dimension des vecteurs | `384` |
| `MAX_UPLOAD_SIZE_MB` | limite de téléversement | `10` |
| `OCR_CONFIDENCE_THRESHOLD` | seuil HITL | `0.85` |
| `ADMIN_TOKEN` | protection des routes d'administration | _(vide)_ |

### Embeddings — modèle, dimension et stratégie

- **Modèle** : `Xenova/all-MiniLM-L6-v2`, exécuté **localement** (aucune clé API,
  fonctionne hors ligne). Téléchargé et mis en cache au premier indexage (~90 Mo).
- **Dimension** : 384.
- **Stratégie de similarité** : **cosinus**. Les vecteurs sont normalisés L2 à la
  production ; la recherche utilise l'opérateur `<=>` de pgvector avec un index HNSW
  (`vector_cosine_ops`). Le score retourné vaut `1 - distance`.

> `docker-compose.yml` charge `.env.local` via `env_file`. Les variables déclarées dans
> `environment:` sont **prioritaires** sur `env_file` : c'est pourquoi `DATABASE_URL` y est
> défini explicitement (la valeur locale `localhost:5433` n'est pas valable à l'intérieur
> du réseau Docker, où la base est joignable en `db:5432`).

---

## 8. Sécurité et journalisation

- Aucune clé API, aucun mot de passe et aucune donnée sensible dans le dépôt :
  `.env`, `.env.local` et `*.pem` sont exclus par `.gitignore`.
- Les journaux n'affichent jamais de clé : les erreurs LLM ne remontent que le statut HTTP
  et un extrait tronqué du corps de réponse.
- `/api/health` ne divulgue ni hôte, ni identifiants : en cas d'échec il renvoie un motif
  générique et un code **503**.
- Téléversements limités par taille (`MAX_UPLOAD_SIZE_MB`) et par extension.
- `intentOverride` (forçage d'intention) est **ignoré** par la route `/api/chat` : il
  n'existe que pour les tests E2E déterministes.

---

## 9. Déploiement

### 9.1 Mode local d'évaluation

`docker compose up -d` démarre :

- `kiraa-db` — PostgreSQL 17 + pgvector, volume persistant `kiraa_pgdata`,
  healthcheck `pg_isready` ;
- `kiraa-app` — Next.js en sortie `standalone` sur Node 20-slim, utilisateur non
  privilégié, healthcheck HTTP sur `/api/health`, démarrage conditionné à la bonne santé
  de la base ;
- réseau interne `kiraa_net` ; `restart: unless-stopped` sur les deux services.

### 9.2 Mode distant de démonstration

Deux blueprints sont fournis dans le dépôt. **Un seul est nécessaire.**

| Fichier | Hébergeur | CLI |
|---|---|---|
| `render.yaml` | Render | déploiement par blueprint, aucun CLI requis |
| `railway.json` | Railway | `npm i -g @railway/cli` |

Dans les deux cas, l'image est construite à partir du `Dockerfile` du dépôt et le
healthcheck HTTP pointe sur `/api/health`, qui vérifie l'application **et** PostgreSQL.

#### Option A — Render (par blueprint)

1. Sur https://dashboard.render.com → **New** → **Blueprint**.
2. Connecter le dépôt GitHub `car-rental`. Render lit `render.yaml` et crée les deux
   composants : le service web `kiraa-app` et la base `kiraa-db`.
3. Renseigner les secrets marqués `sync: false` dans le dashboard :
   `LLM_API_KEY` et, si les routes d'administration sont utilisées, `ADMIN_TOKEN`.
   `DATABASE_URL` est injectée automatiquement depuis la base.
4. Initialiser la base **une seule fois**, depuis un poste disposant de Node.js, en
   utilisant l'URL de connexion externe fournie par Render :

   ```bash
   DATABASE_URL="<external-connection-string>" npm run deploy:init
   ```

   Ce script enchaîne migrations → seed → indexation RAG. Il est idempotent.
5. Vérifier `https://<service>.onrender.com/api/health` → `status: healthy`.

#### Option B — Railway (par CLI)

Procédure vérifiée avec le CLI Railway **5.57.2**.

```bash
npm install -g @railway/cli
railway login                 # ouvre le navigateur (action humaine obligatoire)
railway init                  # cree le projet
railway add --database postgres
```

Variables du service applicatif. `DATABASE_URL` est une **référence** vers le service
Postgres : elle résout vers le réseau privé de Railway, jamais vers `localhost`.

```bash
railway variables set \
  LLM_PROVIDER=groq \
  EMBEDDINGS_PROVIDER=local \
  EMBEDDINGS_MODEL=Xenova/all-MiniLM-L6-v2 \
  EMBEDDINGS_DIMENSION=384 \
  HOSTNAME=0.0.0.0 \
  'DATABASE_URL=${{Postgres.DATABASE_URL}}'

# La cle API est lue sur stdin : elle n'apparait ni dans la ligne de commande,
# ni dans l'historique du shell, ni dans les journaux du terminal.
railway variables set LLM_API_KEY --stdin
```

> `railway variables --set "K=V"` est la **forme héritée** : le CLI actuel attend
> `railway variables set K=V`.

```bash
railway up                    # construit et deploie le Dockerfile
```

Initialisation de la base, **une seule fois**, depuis un poste disposant de Node.js.
`railway run` injecte les variables du projet, dont `DATABASE_URL` qui pointe vers
`*.railway.internal` — un hôte **injoignable depuis votre machine**. Il faut donc
utiliser explicitement l'URL publique du service Postgres :

```bash
# Recuperer l'URL publique (elle contient un mot de passe : ne pas la committer)
railway variables --service Postgres --kv | grep DATABASE_PUBLIC_URL

# Puis initialiser avec cette URL
DATABASE_URL="<DATABASE_PUBLIC_URL>" npm run deploy:init
```

```bash
railway domain                # genere l'URL HTTPS publique
railway logs                  # verifier le demarrage
```

Vérifier enfin `https://<service>.up.railway.app/api/health` → `status: healthy`.

#### Points de vigilance

- **pgvector.** La migration exécute `CREATE EXTENSION IF NOT EXISTS vector`. L'extension
  doit être disponible côté hébergeur. Railway propose des modèles PostgreSQL avec
  pgvector préinstallé ; si `CREATE EXTENSION` échoue sur la base provisionnée par
  `railway add --database postgres`, remplacer ce service par l'image dédiée :
  `railway add --image pgvector/pgvector:pg17`. Vérification directe :
  `railway connect Postgres` puis `CREATE EXTENSION IF NOT EXISTS vector;`.
- **`HOSTNAME=0.0.0.0` est obligatoire.** La sortie `standalone` de Next.js écoute sur
  `$HOSTNAME` ; sans cette variable, le service n'est joignable ni par le healthcheck ni
  par le routeur de l'hébergeur.
- **Premier démarrage plus lent.** Le modèle d'embeddings (~90 Mo) est téléchargé au
  premier appel du RAG et mis en cache dans `TRANSFORMERS_CACHE`.
- **Offres gratuites.** Sur Render, un service web gratuit se met en veille après
  inactivité (premier appel lent) et une base gratuite a une durée de vie limitée.
  Vérifier l'offre au moment de la démonstration.

> **État actuel : le déploiement distant n'a pas encore été exécuté.** Les blueprints,
> le healthcheck, le script d'initialisation et la procédure ci-dessus sont prêts et
> versionnés, mais **aucune URL HTTPS publique n'est active à ce jour** et aucune des
> deux options n'a été validée en conditions réelles.

### 9.3 Protection du seed

`db/seed.ts` n'exécute **aucun** `DELETE`, `TRUNCATE` ni `DROP`. Il procède par `upsert`
sur la clé primaire. Si la base est déjà peuplée **et** que `NODE_ENV=production`, le seed
s'interrompt sans rien modifier, sauf si `SEED_ALLOW_UPDATE=true` est explicitement fourni.

### 9.4 Rollback et archivage

```bash
# Revenir à une version précédente de l'image
docker pull kiraa:<version-precedente>
docker compose up -d --force-recreate app

# Sauvegarder la base avant toute opération risquée
docker exec kiraa-db pg_dump -U kiraa kiraa > sauvegarde-$(date +%F).sql

# Restaurer
cat sauvegarde-<date>.sql | docker exec -i kiraa-db psql -U kiraa -d kiraa

# Arrêt sans perte de données (le volume est conservé)
docker compose down

# Suppression COMPLÈTE, volume inclus — destructif et irréversible
docker compose down -v
```

Les migrations Drizzle sont additives : un rollback applicatif ne nécessite pas de
migration descendante tant que le schéma reste compatible.

---

## 10. Démonstration fonctionnelle (5 minutes)

1. **Santé** — ouvrir `/api/health` : `status: healthy`, `database: ok`.
2. **Question de politique** — saisir *« Puis-je annuler 24 heures avant la prise en
   charge ? »* → réponse issue du RAG, sources citées avec leur score de similarité,
   **aucun montant** affiché. La trace montre que `validator_node` est absent.
3. **Éligibilité refusée** — paramètres `birthDate: 2007-03-10` → statut `REJECTED`,
   motif explicite, **aucun calcul de prix**.
4. **Jeune conducteur Premium** — 22 ans + véhicule Premium → `PENDING_REVIEW`,
   caution 22 500 MAD (15 000 × 1,5), motif d'escalade affiché.
5. **Remise plafonnée** — code `FLASH25` (25 %) → badge « plafonnée à 15 % ».
6. **Ingestion réelle** — téléverser `samples/sample_id_and_license.jpg` et
   `samples/sample_test_document.pdf` → tableau des documents avec moteur `ocr` et
   `native_pdf`, scores de confiance, statut de revue.
7. **Devis PDF** — cliquer sur « Télécharger le devis PDF ».

---

## 11. Structure du projet

```
app/                    routes Next.js (App Router)
  api/chat/route.ts     exécution de l'agent, génération PDF
  api/health/route.ts   healthcheck app + PostgreSQL
components/ChatUI.tsx   interface cliente
db/                     schéma Drizzle, migrations, client, seed
drizzle/                migrations SQL générées
lib/
  agent/                graphe LangGraph.js, nœuds, accès aux données
  engine/               moteur déterministe (fonctions pures)
  ingestor/             ingestion multi-format et OCR
  llm/                  client LLM configurable
  rag/                  embeddings, fragmentation, recherche pgvector
  reporter/             génération du devis PDF
  schemas/              contrats Zod partagés
data/                   CSV sources et corpus RAG
samples/                fichiers de test réels (JPG, PDF, JSON, TXT)
tests/                  Vitest — unitaires et E2E
```

---

## 12. Convention de nommage du dépôt

Le nom du dépôt et le format de remise sont communiqués par l'encadrement
(cahier des charges §9). Renseigner ici le nom retenu par le groupe avant la remise :

- **Dépôt** : `<à compléter>`
- **Groupe** : `<à compléter>`

---

## 13. Rapport de readiness

| Élément | État |
|---|---|
| Moteur déterministe — parité notebook | ✅ 14/14 assertions |
| Tests unitaires + E2E | ✅ 33/33 |
| Scénarios du cahier des charges | ✅ 5/5 |
| TypeScript strict | ✅ aucune erreur |
| PostgreSQL + pgvector | ✅ opérationnel |
| Corpus RAG indexé | ✅ 20 fragments, 384 dimensions |
| Ingestion JPG / PDF / JSON / TXT | ✅ vérifiée sur fichiers réels |
| Docker Compose local | ✅ les deux services `healthy` |
| Interface Next.js | ✅ accessible sur http://localhost:3000 |
| Génération du devis PDF | ✅ |
| Secrets dans le dépôt | ✅ aucun |
| **Déploiement distant HTTPS** | ❌ **non réalisé** |
