# Stack technique et sources de données

> Version 0.3 (6 novembre 2026), décisions intégrées. Complète `projet-reco-films.md`.
> Principe directeur : **tout ce qui peut être calculé à l'avance l'est, et le site reste 100 % statique.** Pas de serveur à payer, pas de données utilisateur stockées.

---

## 1. Vue d'ensemble

```
┌─────────────── HORS LIGNE (notre PC / Google Colab) ───────────────┐
│                                                                     │
│  MovieLens 32M ─┐                                                   │
│  IMDb datasets ─┼─► Python : nettoyage, correspondance des ids,     │
│  TMDB API ──────┘   entraînement du modèle, évaluation              │
│                              │                                      │
│                              ▼                                      │
│            Fichiers statiques : vecteurs des films, popularité,     │
│            catalogue (titres, années, ids, affiches)                │
└──────────────────────────────┬──────────────────────────────────────┘
                               │  (régénérés chaque mois par GitHub Actions)
┌──────────────────────────────▼──── EN LIGNE (navigateur de l'utilisateur) ┐
│                                                                           │
│  Fichier de l'utilisateur ─► adaptateur ─► correspondance des titres      │
│        ─► calcul des scores ─► curseur connu/pépite ─► affichage          │
│                                                                           │
│  Hébergé sur Cloudflare Pages ou GitHub Pages (gratuit)                   │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Sources de données

### 2.1 Pour entraîner le modèle

| Source | Ce qu'on prend | Où | Licence | Rôle |
|---|---|---|---|---|
| **MovieLens 32M** (GroupLens) | `ratings.csv` (32 M de notes, ~200 000 utilisateurs, ~87 000 films, 1995-2023), `movies.csv`, `links.csv` (MovieLens ↔ IMDb ↔ TMDB) | grouplens.org/datasets/movielens/32m | Non commercial, citer le dataset | **Source principale** du filtrage collaboratif |
| **IMDb Non-Commercial Datasets** | `title.basics.tsv` (titres, titres originaux, année, durée, genres), `title.ratings.tsv` (note moyenne, nombre de votes) | datasets.imdbws.com | Usage personnel et non commercial | Correspondance des titres + **mesure de popularité** pour le curseur |
| **TMDB API** | Affiches, réalisateur, pays, langue, résumé, plateformes de streaming par pays | developer.themoviedb.org | Gratuit en non commercial, attribution obligatoire, cache ≤ 6 mois | Enrichir l'affichage, filtre « dispo en France » plus tard |

### 2.2 Pour évaluer (pas pour le site)

| Source | Rôle | Réserve |
|---|---|---|
| **Nos propres exports Letterboxd** + ceux de volontaires | Vérifier que le modèle marche sur de vrais cinéphiles | Avec leur accord |
| Dataset *Letterboxd 10M* (Hugging Face, déc. 2025) | Tester le biais « public MovieLens » vs « public Letterboxd » | Données scrapées, CC-BY-NC-SA : **usage d'évaluation uniquement**, jamais embarqué dans le site |

### 2.3 Fournies par l'utilisateur

| Source | Format | Identifiant disponible | Échelle de notes |
|---|---|---|---|
| **Letterboxd** | ZIP d'export (`ratings.csv`, `watched.csv`, `diary.csv`, `watchlist.csv`) | ❌ Pas d'id IMDb/TMDB : seulement titre + année + URL Letterboxd | 0,5 à 5 |
| **IMDb** | CSV d'export des notes | ✅ Id IMDb (`tt…`) : correspondance directe | 1 à 10 |
| **Liste faite main** (plus tard) | Texte libre | ❌ Titre (et parfois année) | Variable ou absente |

> ⚠️ Colonnes exactes des exports à vérifier sur de vrais fichiers avant de coder les adaptateurs.

---

## 3. Partie hors ligne : données et modèle

| Besoin | Outil | Pourquoi |
|---|---|---|
| Langage | **Python 3.12** | Standard pour la data et les recsys |
| Gestion de l'environnement | **uv** | Rapide, simple, reproductible |
| Manipulation des données | **Polars** (ou pandas) | Polars tient 32 M de lignes sans problème sur un PC |
| Calcul matriciel | **NumPy**, **SciPy** (matrices creuses) | Base de tous les modèles |
| **Modèle retenu** | **ALS** via la librairie `implicit` | Vecteurs compacts, faciles à charger dans le navigateur |
| Modèle de comparaison (hors ligne uniquement) | **EASE** codé en NumPy (~20 lignes) | Référence de précision pour juger ALS ; jamais embarqué dans le site |
| Modèle n°3 (plus tard) | **SASRec** (PyTorch) exporté en ONNX | Tient compte de l'ordre du journal de visionnage |
| Évaluation | Scripts maison (Recall@20, NDCG@20, popularité moyenne, couverture du catalogue) | Mesurer précision **et** découverte |
| Expérimentation | **Jupyter** en local ou **Google Colab** (gratuit) | Colab si le PC manque de RAM |
| Qualité du code | **ruff** | Lint + formatage |

### Points d'attention
- **Taille du catalogue embarqué (décidé)** : seuil bas de **≥ 20 notes** dans MovieLens, cible **~20 000 à 25 000 films**. On garde volontairement la longue traîne (ce sont les pépites). Seuil ajusté pour rester autour de **5 Mo** de données au total.
- **Pourquoi ALS et pas EASE en production** : EASE produit une matrice film × film, trop lourde pour le navigateur. ALS donne un vecteur de 64-128 nombres par film.
- **Compression** : vecteurs en `float16` ou quantifiés en `int8` → 25 000 films × 64 dims × 1 octet ≈ **1,6 Mo**.
- **Films récents (après 2023), décidé** : absents de MovieLens, donc non recommandables. **On accepte le trou au MVP** et on l'affiche honnêtement sur le site. En v2 : modèle basé sur le contenu (genres, mots-clés, réalisateur via TMDB).

### Fichiers produits (dans `web/public/data/`)
| Fichier | Contenu | Taille visée |
|---|---|---|
| `catalog.json` | id interne, titre, titre original, année, id IMDb, id TMDB, chemin de l'affiche, réalisateur | 2-4 Mo (compressé gzip/brotli par l'hébergeur) |
| `embeddings.bin` | vecteurs des films (binaire) | 2-4 Mo |
| `popularity.bin` | nombre de votes par film (log), pour le curseur | < 200 Ko |
| `title-index.json` | index des titres normalisés pour la correspondance | 1-2 Mo |

---

## 4. Partie en ligne : le site

| Besoin | Outil | Pourquoi |
|---|---|---|
| Langage | **TypeScript** | Typage, moins de bugs |
| Build / serveur de dev | **Vite** | Rapide, standard |
| Framework UI | **React 18+** (décidé) | Le plus répandu, énormément de ressources et d'aide |
| État de l'interface | `useState` / `useReducer` ; **Zustand** seulement si l'état devient partagé entre beaucoup d'écrans | Rester simple |
| Navigation entre écrans | **React Router**, ou un simple état « étape » si le site reste à 3-4 écrans | Pas besoin de plus pour un site statique |
| Style | **Tailwind CSS** | Rapide pour prototyper, cohérent |
| Polices | **Courier Prime** + **Caveat** (Google Fonts) | Direction visuelle « C · Fanzine » retenue |
| Lecture des CSV | **PapaParse** | Robuste, gère les virgules dans les titres, les encodages |
| Lecture du ZIP Letterboxd | **fflate** | Petit et rapide, dézippe dans le navigateur |
| Correspondance floue des titres | **Fuse.js** (ou un index maison normalisé) | Gérer « Le Fabuleux Destin d'Amélie Poulain » vs « Amélie » |
| Calcul des scores | TypeScript pur sur des `Float32Array` | Produit scalaire sur 30 000 films = quelques millisecondes |
| Calcul lourd sans bloquer la page | **Web Worker** | L'interface reste fluide pendant le calcul |
| Cache du modèle | **IndexedDB** (via `idb-keyval`) | Le modèle n'est téléchargé qu'une fois |
| Modèle SASRec (plus tard) | **ONNX Runtime Web** | Fait tourner un modèle PyTorch exporté dans le navigateur |
| Tests | **Vitest** + **React Testing Library** | Tester les adaptateurs, la normalisation des notes et les composants clés |
| Qualité du code | **ESLint** + **Prettier** | Standard |

### Comment on calcule une recommandation (ALS)
1. On construit le vecteur de goût de l'utilisateur à partir de ses films notés (« fold-in » : une petite résolution de moindres carrés, faisable dans le navigateur).
2. Score de chaque film = produit scalaire entre ce vecteur et le vecteur du film.
3. On retire les films déjà vus.
4. **Curseur** : `score_final = score − λ × log(popularité)`, λ suit la position du curseur.
5. On affiche les 50 meilleurs.

---

## 5. Hébergement et automatisation

| Besoin | Outil | Coût |
|---|---|---|
| Code source | **GitHub** | Gratuit |
| Hébergement du site | **Cloudflare Pages** (ou GitHub Pages) | Gratuit |
| Fichiers du modèle | Dans le site si < limite de taille par fichier de l'hébergeur ; sinon **Cloudflare R2** | Gratuit dans les quotas |
| Mise à jour mensuelle des métadonnées TMDB | **GitHub Actions** (tâche planifiée) | Gratuit |
| Nom de domaine | Registrar au choix | ~10-15 €/an (optionnel) |
| Statistiques de visite (optionnel) | **GoatCounter** ou équivalent sans cookies | Gratuit |
| Retours utilisateurs | Formulaire simple (Tally, Google Forms) | Gratuit |

> ⚠️ Limites de taille par fichier et quotas gratuits à vérifier au moment du déploiement.

### Pourquoi pas d'appel TMDB depuis le navigateur ?
Appeler TMDB depuis le site exposerait notre clé d'API. On **pré-calcule** donc les infos utiles (affiches, réalisateurs) dans `catalog.json` lors de la mise à jour mensuelle. Les images d'affiches, elles, sont chargées directement depuis le serveur d'images de TMDB (pas besoin de clé).

---

## 6. Fonctions « à garder en tête » : ce qu'elles demanderaient

| Fonction | Ce qu'il faut en plus | Impact sur la stack |
|---|---|---|
| **Liste faite main remise en forme par IA** (décidé) | **MVP : pas d'IA**, correspondance floue des titres (Fuse.js + index des titres). **Plus tard** : un petit modèle via API pour les cas difficiles. | L'API passe par un **Cloudflare Worker** (pour cacher la clé), avec une **limite d'usage** pour maîtriser le coût. Modèle dans le navigateur écarté pour l'instant (trop lourd). |
| **Scraping Letterboxd par pseudo** | Récupérer les pages publiques du profil | Impossible depuis le navigateur (CORS) → il faut un **Cloudflare Worker**. ⚠️ Contraire aux conditions de Letterboxd et fragile : option secondaire uniquement. |
| **Filtre « dispo en France »** | Endpoint *watch providers* de TMDB pour chaque film du catalogue | Pré-calculé chaque mois par GitHub Actions, ajouté à `catalog.json` (région FR uniquement). |
| **Explications** | Pour chaque reco, les films de l'utilisateur les plus proches | Aucun outil en plus : calcul de similarité entre vecteurs, déjà disponible. |
| **Autres imports** (SensCritique, Trakt…) | Un adaptateur par source | Aucun outil en plus si la source fournit un export. |
| **Films récents** | Modèle basé sur le contenu (genres, mots-clés, réalisateur, résumé) | Données TMDB + éventuellement embeddings de texte calculés hors ligne. |

---

## 7. Organisation du dépôt

```
projet/
├── pipeline/                 # Python, hors ligne
│   ├── download.py           # télécharge MovieLens et IMDb datasets
│   ├── build_catalog.py      # fusionne MovieLens + IMDb + TMDB
│   ├── train.py              # entraîne EASE / ALS
│   ├── evaluate.py           # Recall, NDCG, popularité, couverture
│   ├── export.py             # écrit les fichiers dans web/public/data
│   ├── notebooks/
│   ├── tests/
│   └── data/                 # raw/, processed/, cache/ : contenu ignoré par git
├── web/                      # site statique
│   ├── src/
│   │   ├── adapters/         # letterboxd.ts, imdb.ts, (manual.ts)
│   │   ├── matching/         # correspondance des titres
│   │   ├── reco/             # fold-in, scores, curseur (dans un Web Worker)
│   │   ├── components/       # composants React (Curseur, CarteFilm, ZoneDepot…)
│   │   ├── pages/            # Accueil, Analyse, Resultats, Fiche
│   │   └── styles/           # tokens de la direction C (design-system.md)
│   └── public/data/          # fichiers produits par le pipeline
├── .github/workflows/        # mise à jour mensuelle TMDB
├── docs/                     # projet-reco-films.md, stack-technique.md, design-system.md, etat-de-l-art.md, maquette
└── CLAUDE.md                 # instructions pour Claude Code
```

### Secrets
- `TMDB_API_KEY` (clé v3) et `TMDB_READ_TOKEN` (jeton v4, optionnel) : stockés **uniquement** dans les secrets GitHub (Settings → Secrets and variables → Actions) et dans le fichier `.env` à la racine, **ignoré par git** (modèle vide : `.env.example`). Jamais dans le code du site, jamais dans un commit.

---

## 8. Ordre de construction conseillé

1. **Pipeline de données** : télécharger MovieLens + IMDb, construire le catalogue et les correspondances d'ids.
2. **Modèle** : ALS (et EASE pour comparer), évaluation hors ligne avec et sans curseur.
3. **Adaptateur Letterboxd** + correspondance des titres, testé sur nos propres exports.
4. **Calcul dans le navigateur** : fold-in, scores, curseur.
5. **Interface** : dépôt du fichier, liste de recos, curseur.
6. **Adaptateur IMDb**.
7. Mise en ligne, tests avec 10-20 cinéphiles.
8. Ensuite seulement : explications, dispo en France, liste faite main, scraping.

---

## 9. Décisions prises (6 novembre 2026)

| Sujet | Décision |
|---|---|
| Modèle en production | **ALS** (EASE seulement pour comparer hors ligne) |
| Catalogue | **≥ 20 notes**, ~20 000 à 25 000 films, ~5 Mo de données |
| Films récents | **Trou accepté au MVP**, modèle de contenu en v2 |
| Framework | **React** + Vite + TypeScript |
| IA pour les listes faites main | **Pas d'IA au MVP** (Fuse.js) ; API + Cloudflare Worker plus tard |
| Licences | **Contact direct** avec GroupLens et TMDB |

## 10. Actions

- [x] Clé API TMDB obtenue (à stocker dans les secrets GitHub et un `.env` local ignoré par git)
- [x] Mail envoyé à GroupLens → réponse en attente (bloquante seulement pour la mise en ligne)
- [x] Framework choisi : React

## 11. Questions encore ouvertes

- [ ] Réponse de GroupLens
