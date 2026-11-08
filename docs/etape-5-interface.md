# Étape 5 — Interface (direction C · Fanzine)

> Version 0.2 (8 novembre 2026 ; 0.2 : ajustements de Thibault sur D5, D6, D8 et G6). Spécification de l'étape 5 de l'ordre de construction (`stack-technique.md` §8).
> Plan validé par Thibault le 8 novembre 2026. **Document autonome** : une nouvelle session qui lit `CLAUDE.md` puis ce fichier doit pouvoir démarrer sans autre contexte.

---

## 0. Mode d'emploi (pour Claude Code)

- **Relis ce document au début de chaque sous-étape.** Les décisions de la section 3 ne changent pas sans accord ; si l'une pose problème, arrête-toi et explique pourquoi.
- Une sous-étape à la fois (G0 → G6), en suivant « Quand s'arrêter » de `CLAUDE.md` : si tous les critères sont atteints et qu'il n'y a rien à trancher, résultats en section 5, commit, push, puis sous-étape suivante sans attendre.
- **Arrêts obligatoires** :
  1. **fin de G1** : liste des titres corrigés à la main (action `title`) à faire valider par Thibault avant de l'appliquer ;
  2. **fin de G6** : relecture de l'étape (captures d'écran, temps, décision sur la mention « spectacle »), puis mise à jour de `CLAUDE.md` et `stack-technique.md` (diff montré avant le commit) ;
  3. tout critère qui échoue, ou tout choix qui sort des décisions de la section 3.
- **Avant chaque arrêt** : tout est commité et poussé, et la section 5 est à jour.
- **Textes de l'interface** : en français, ton de `docs/design-system.md` (tutoiement, minuscules, phrases courtes, un peu d'humour, jamais snob, on parle cinéma, pas algorithme). Les textes cités dans ce document sont à reprendre **tels quels**. Code, variables et commentaires en anglais.
- **Données personnelles** : jamais de titre ni de pseudo d'un export réel dans un fichier versionné. Les exports réels sont dans `web/test-data/exports/` (ignoré). Les captures faites avec l'export de Thibault ne sont montrées qu'à lui, jamais versionnées. Les captures versionnables ne montrent que l'export d'exemple synthétique.
- Avant de coder un écran, **ouvre `docs/maquette-C-fanzine.html`** et `docs/design-system.md` : ce sont les références visuelles. Ils priment sur toute autre idée de mise en page.

---

## 1. Objectifs

1. Construire l'interface du site en direction « C · Fanzine », sur trois écrans : **accueil et dépôt**, **analyse du fichier**, **recommandations avec le curseur**. S'y ajoute une page **« à propos »** pour les mentions obligatoires.
2. Brancher l'interface sur le moteur existant (`RecoClient`, Web Worker), sans aucun envoi de données de l'utilisateur.
3. Traiter les points reportés des étapes 3 et 4 : films trop récents, films non reconnus, documentaires et spectacles, versions et suites, titres anglais faux, indicateur « loin de tes goûts ».
4. Vérifier le tout dans un vrai navigateur (Playwright), y compris en vue téléphone, et mesurer les temps.

---

## 2. Ce qui existe déjà (à lire avant de coder)

### 2.1 Données du site (`web/public/data/`, non versionnées)

Elles sont produites par le pipeline :
```sh
cd pipeline
uv run python export.py export --out web
uv run python export.py catalog --out web
```
Le premier appel écrit aussi `web/test-data/foldin_cases.json`.

| Fichier | Contenu |
|---|---|
| `embeddings.bin`, `yty.bin` | modèle ALS (int8 + échelles ; YᵀY) |
| `popularity.bin` | popularité du curseur (uint32 par film) : `max(arrondi(ml_rating_count × f_année), arrondi(0,285 × tmdb_vote_count))`, `f_année = max(1, 0,285 / r_année)` ; correction des films récents, `pipeline/popularity.py` |
| `model-meta.json` | hyperparamètres, positions du curseur `[null, 20000, 10000, 5000, 2000, 1000, 500, 200]` (`null` = ∞), films non recommandables, formule de popularité et facteurs par année |
| `catalog.json` | en colonnes, ordre `item_idx` : `title` (titre affiché), `original_title` (creux), `year`, `tmdb_id`, `imdb_id`, `imdb_id_aliases`, `directors`, `poster_path`, `genres` (indices dans `genre_names`, genres MovieLens dont « Documentary ») |
| `title-index.json` | index de correspondance des titres (normalisation `titles-v2`) |

### 2.2 Code du site (`web/`, Vite + React 19 + TypeScript strict, Vitest, ESLint, Prettier)

- `src/adapters/` : `letterboxd.ts` (ZIP, dossier ou CSV seul ; lit `ratings.csv`, `watched.csv`, `diary.csv`, jamais `profile.csv`), `normalizeRatings.ts` (percentiles), `types.ts` (`HistoryEntry`).
- `src/matching/` :
  - `normalize.ts` ;
  - `titleIndex.ts` ;
  - `match.ts`, avec les statuts `exact`, `probable_variant`, `probable_fuzzy`, `ambiguous`, `not_found` ;
  - `history.ts` : `toUserHistory` et `RECOMMENDATION_STATUSES` = `exact` et `probable_variant`.
- `src/reco/` :
  - `engine.ts` : moteur unique (`loadEngine`, `importExport`, `exclusions`, `recommend`) ;
  - `workerCore.ts` : protocole des messages et `createHandler` ;
  - `worker.ts` : le Web Worker ;
  - `client.ts` : **`RecoClient`, API à base de promesses à utiliser par l'interface**.
- Protocole actuel de `RecoClient` :
  - `init()` → `{ nItems, positions, timings }` ; charge les 6 fichiers et construit le `Matcher` (~0,5 s).
  - `importExport({ kind: 'zip', bytes } | { kind: 'files', files } | { kind: 'csv', name, text })`, qui renvoie :
    - `summary` : `nEntries`, `counts` par statut, `nHistoryFilms`, `warnings`, `filesRead` ;
    - `unrecognized[]` : les entrées non utilisées, avec `title`, `year`, `status` et `candidates: FilmCard[]`.
  - `recommend({ n, caps })` → `{ nHistory, nExcluded, positions: [{ cap, relativeScore, films: (FilmCard & { score })[] }] }`.
  - `FilmCard` = `{ item, title, year, directors, posterPath, popularity }`.
- **Règles du moteur** (ne pas changer) :
  - historique du fold-in : `exact` et `probable_variant` seulement ;
  - exclus des recommandations : films vus, non recommandables, candidats à égalité des `ambiguous`, candidat principal des `probable_fuzzy` ;
  - le flou n'est jamais utilisé automatiquement.
- **Moteur unique** : toute modification passe par `engine.ts`, `workerCore.ts` et `client.ts`. Il doit toujours rejouer `foldin_cases.json` (22 vecteurs à 10⁻⁹ près, 66 listes top 10 identiques) : les tests `src/reco/reco.test.ts` doivent rester verts.
- `src/App.tsx` est une page provisoire (bouton « tester le moteur ») à remplacer.
- Dossiers prévus et vides : `src/components/`, `src/pages/`, `src/styles/`.
- Scripts du terminal : `npm run match-report`, `npm run reco-report -- <export>` (top 20 à ∞ / 2 000 / 500), `npm run reco-bench`.

### 2.3 Mesures utiles (étapes 2 à 4)

- Score relatif (score moyen des 20 premiers à une position / celui de ∞) : moyenne des utilisateurs de test 0,17 au plafond 2 000 et 0,06 à 500 ; Thibault 0,18 et 0,05.
- Export de Thibault : 225 films, 188 reconnus. Les 37 autres : 25 sortis en 2024-2026, 5 de 2023 sous le seuil, 2 absents de MovieLens, 5 séries. 11 % de l'export est sorti en 2024-2026.
- Temps du moteur (Node) : lecture des fichiers 133 ms, `Matcher` 405 ms, recommandations 19 ms pour un export réel.

---

## 3. Décisions

### D1. Socle visuel

- **Tailwind CSS v4** (`@tailwindcss/vite`). Les jetons de `design-system.md` §2 sont déclarés dans `@theme` (`src/styles/`) :
  - `paper` #FBFAF7, `white` #FFFFFF ;
  - `ink` #1B1B1B, `muted` #555049 ;
  - `rule` #B9B4AA, `pen` #2546B8 ;
  - `tape` rgba(214, 208, 196, 0.75).

  **Un seul accent** : le stylo bleu, réservé aux annotations manuscrites et aux pépites.
- **Polices auto-hébergées** (décision de Thibault) : `@fontsource/courier-prime` (400, 700, 400 italique) et `@fontsource/caveat` (500, 700), licence OFL. **Aucune requête vers Google** (cohérent avec « pas de tracking »). La section 3 de `design-system.md` est mise à jour : le lien Google Fonts est remplacé par les paquets.
- Typographie, tailles, rotations, composants et mise en page : `design-system.md` §3, §5 et §6, **à la lettre**.
  - Colonne de 820 px pour l'accueil et l'analyse, 1 100 px pour les résultats ; marges de 24 px ; tout aligné à gauche ; une action principale par écran.
  - Ni emoji, ni dégradé, ni ton commercial, ni orange sur fond sombre.

### D2. Navigation

- Machine à états dans `App` : `accueil` → `analyse` → `resultats`. « ← changer de fichier » ramène à l'accueil ; la page « à propos » s'ouvre par `#a-propos`.
- Pas de React Router, et **aucun stockage** de l'historique ni des résultats : un rechargement ramène à l'accueil (« on garde rien »).

### D3. Écran 1 — accueil et dépôt (maquette, textes exacts)

- En-tête : logo « pépite » + annotation « (nom provisoire) » ; navigation « comment ça marche » (ancre de la page à propos) et « qui on est ».
- Titre : « salut. donne-nous ta liste de films, on te trouve ceux que t'as pas encore vus. », avec le souligné ondulé en SVG sous « pas encore vus. ».
- **Zone de dépôt** :
  - un vrai `<label>` lié à `<input type="file" accept=".zip,.csv">`, accessible au clavier, avec en plus le glisser-déposer ;
  - textes : « glisse ton fichier ici » / « l'export de letterboxd (le .zip) ou tes notes imdb (le .csv) » ;
  - annotation « c'est là » avec la flèche en SVG ; sur téléphone, elle passe sous la zone.
- Promesses : « × pas de compte à créer » / « × pas de pub, pas de tracking » / « × on garde rien : tout se passe dans ton navigateur ».
- Liens :
  - « montre-moi un exemple → » lance tout le parcours avec un **export d'exemple synthétique** servi par le site (`web/public/exemple/`) : de vrais films connus, des notes inventées, aucune donnée personnelle ;
  - « je sais pas où trouver mon export » déplie une aide courte (Letterboxd → réglages → import & export → exporter tes données).
- Le modèle se charge (`init`) dès l'arrivée sur la page, sans bloquer. Si un fichier est déposé avant la fin, on affiche « on prépare nos fiches… » puis on enchaîne.
- Un **CSV IMDb** déposé reçoit « les exports imdb arrivent bientôt » jusqu'à l'étape 6. Pour un fichier illisible ou qui n'est pas un export, un message court dans le ton (par ex. « hmm, ça ressemble pas à un export letterboxd. »).
- Pied de page de toutes les pages : « fait à la main par des gens qui regardent trop de films. projet indépendant, sans lien avec letterboxd ni imdb. » + « This product uses the TMDB API but is not endorsed or certified by TMDB. ».

### D4. Écran 2 — analyse du fichier (nouveau, en style C)

- Titre : « on a lu tes N films. on en a reconnu M. ».
- **À vérifier** (entrées `ambiguous` et `probable_fuzzy`) :
  - pour chaque entrée, le titre et l'année de l'export, puis ses candidats en boutons radio (affiche miniature, titre, réalisateur, année), plus « aucun de ceux-là » ;
  - **rien n'est coché par défaut** : le flou n'est jamais pris automatiquement ;
  - un candidat choisi est **confirmé** : nouveau message de worker `confirm` (`RecoClient.confirm(choices)`, où `choices` associe l'index de l'entrée au film choisi ou à `null`) et nouveau statut **`confirmed`**, ajouté à `RECOMMENDATION_STATUSES` (il entre dans le fold-in) ;
  - une entrée non confirmée garde ses exclusions (D4 de l'étape 4) ;
  - `unrecognized[]` doit donc porter l'index de l'entrée.
- **Trop récents** : les `not_found` dont l'année est ≥ 2024 sont comptés, avec « N films sont sortis après 2023 : trop récents pour nous, désolé. » ; la liste est dépliable.
- **Pas dans notre catalogue** (les autres `not_found`) : « N films qu'on connaît pas (séries, films très peu vus…) », liste dépliable. Les séries ne sont pas détectables dans l'export, d'où cette formulation.
- S'il n'y a rien à vérifier, la section n'apparaît pas. Bouton principal : « voir mes films ».
- Aucun film reconnu : message clair (« on n'a reconnu aucun de tes films… ») et retour à l'accueil.

### D5. Écran 3 — recommandations (maquette)

- **Titre** : « on a lu tes N films. » suivi d'une phrase qui dépend de la position du curseur. On reprend les trois textes de la maquette :
  - ∞, 20 000, 10 000 : « voilà des classiques qui devraient te plaire. » ;
  - 5 000, 2 000 : « voilà un mélange de classiques et de découvertes. » ;
  - 1 000, 500, 200 : « voilà huit films que t'as sûrement jamais vus. ».

  Le nombre (« huit ») suit le nombre de cartes affichées : il change quand « encore des films » en ajoute (« seize », « vingt-quatre »…).
- **Annotation de profil** : « (t'aimes bien X, Y et Z, non ?) », en Caveat, inclinée. X, Y, Z sont les 3 réalisateurs les plus fréquents parmi les films de l'historique utilisé (fold-in) notés au-dessus de leur médiane (percentile > 0,5), d'après `catalog.json`. Avec moins de 2 réalisateurs, l'annotation est masquée.
- **Curseur** :
  - `<input type="range">` natif, **8 crans** (positions de `model-meta.json`, de ∞ à 200), `accent-color` stylo bleu, zone tactile de 44 px ;
  - libellé « plutôt connu ou plutôt pépite ? », étiquettes « les classiques » / « les trucs que personne connaît » ;
  - le cran courant affiche son plafond (« moins de 2 000 notes » ; rien à ∞) ;
  - position de départ : 2 000 (milieu-droit, comme la maquette qui démarre à 70 %).
- **Mise à jour en direct** : les 8 positions sont calculées par **un seul** `recommend({ n: 48 })` après l'analyse. Glisser le curseur ne fait qu'afficher une autre liste, sans nouveau calcul (≤ 50 ms visé).
- **Grille** : 8 cartes, puis le bouton « encore des films » en ajoute 8 (jusqu'à 48).
- **Indicateur « loin de tes goûts »** : si le score relatif de la position est **< 0,04**, une annotation en Caveat « (là, on s'éloigne pas mal de tes goûts habituels) » sous le curseur.
  - Seuil choisi par Thibault (ajustement du 8 novembre 2026). À 0,10, l'annotation s'afficherait pour tout le monde dès 1 000 notes, y compris sur des listes cohérentes. Mesures : Thibault 0,05 à 500 avec une liste cohérente ; un profil grand public 0,028 avec une liste incohérente.
  - À recalibrer avec les exports des volontaires (voir section 6).
- **Films récents** : sous la grille, « on connaît moins bien les films sortis après 2023, désolé. ».
- « dis-nous si on s'est planté, ça nous aide » : annotation sans lien pour l'instant (le formulaire viendra avec la mise en ligne, étape 7).
- Les boutons « ça me tente » / « pas pour moi » ne sont **pas** dans l'étape 5 : sans serveur, il n'y a rien à enregistrer.

### D6. Carte film (« photo scotchée »)

- Conforme à `design-system.md` §5 :
  - fond blanc, padding de 12 px (18 px en bas), ombre `0 1px 2px rgba(0,0,0,0.12)` ;
  - rotation de −1,8° à +1,8°, **déterministe** d'après `item_idx` ;
  - bout de scotch de 72 × 22 px ;
  - affiche au format 2:3 depuis `https://image.tmdb.org/t/p/w342<poster_path>`, en `loading="lazy"`, avec un `alt` (titre). Sans affiche : un cadre uni encre pâle ;
  - titre en gras 16 px, puis « réalisateur, année » en encre pâle 13 px.
- **« ✱ pépite »** (Caveat gras, stylo bleu, incliné à −12°, qui déborde du bord droit) si la popularité du film est **≤ 1 000 et** que le plafond courant du curseur est **> 1 000** (∞ à 2 000). Aux plafonds 1 000, 500 et 200, toutes les cartes seraient tamponnées et le tampon ne distinguerait plus rien : il n'apparaît pas.
- **Documentaires** : la mention « documentaire » sous le titre si le film a le genre MovieLens « Documentary ». Une case « sans les documentaires » sous le curseur filtre la liste déjà calculée (côté client), sans nouveau calcul.
- **Spectacles** : heuristique à mesurer en G4 (titre de la forme « Prénom Nom: … » et genre unique « Comedy »). La liste détectée sur le catalogue est montrée à Thibault en G6. La mention « spectacle » n'est ajoutée que s'il la juge fiable ; sinon c'est reporté (enrichissement TMDB des genres).
- **Suites et versions** : si le film a le même titre principal (avant « : » ou « - ») et un réalisateur en commun avec un film de l'historique, une annotation en Caveat « (même série que « X », que t'as vu) ».
  - Pas de masquage : sur 237 groupes de ce type dans le catalogue, presque tous sont des suites ; seuls *Kill Bill* et *South Park* contiennent une vraie version alternative.
- **Lien** (décision de Thibault) : toute la carte est un lien vers `https://letterboxd.com/tmdb/<tmdb_id>/`, dans un nouvel onglet, avec `rel="noopener noreferrer"`. Sans `tmdb_id`, la carte n'est pas un lien. La fiche film viendra plus tard (étape 8).

### D7. Titres corrigés à la main (action `title` de `manual_overrides.csv`)

- Constat : 728 films ont un titre TMDB différent de tous leurs titres MovieLens et de leur titre original. Ce sont presque tous de vrais titres anglais (*The Intouchables*, *Oldboy*, *Castle in the Sky*). Un seul cas évident parmi les plus notés : « Warriors of the Wind » pour *Nausicaä de la vallée du vent* (TMDB 81), le titre de l'ancien montage américain.
- Décision de Thibault : une **nouvelle action `title`** dans `pipeline/manual_overrides.csv` (`movie_id`, titre affiché, raison).
  - Elle est appliquée par `pipeline/site_catalog.py` : titre affiché dans `catalog.json`, et clé de titre ajoutée à `title-index.json` avec la priorité de `tmdb_title` (source 0).
  - Le modèle et `catalog.parquet` ne sont pas touchés.
  - La règle de `CLAUDE.md` passe de « `exclude` / `merge_into` » à « `exclude` / `merge_into` / `title` ».
- Première entrée : *Nausicaä* → « Nausicaä of the Valley of the Wind ». En G1, relire les titres divergents à ≥ 2 000 notes (8 films) et ≥ 1 000 notes, proposer la liste : **arrêt pour validation**.

### D8. Page « à propos » (mentions obligatoires)

- Contenu, dans le ton du site :
  - qui on est (projet étudiant, M2 ECE Paris, non commercial) ;
  - comment ça marche, en mots simples (on lit ton export dans ton navigateur, on compare tes goûts à ceux de milliers de cinéphiles, le curseur choisit entre films connus et pépites) ;
  - « on garde rien » ;
  - les limites (films après 2023, séries, films très peu vus) ;
  - « compatible avec les exports Letterboxd et IMDb » ;
  - les affiches, honnêtement : « les affiches viennent de tmdb : leurs serveurs voient passer les affiches affichées, rien d'autre. ».
- **Mentions obligatoires**, à ne pas reformuler :
  - **logo TMDB** (fichier local, selon les règles d'usage de TMDB) + « This product uses the TMDB API but is not endorsed or certified by TMDB. » ;
  - **MovieLens** : citation F. Maxwell Harper and Joseph A. Konstan. 2015. *The MovieLens Datasets: History and Context.* ACM Transactions on Interactive Intelligent Systems (TiiS) 5, 4, Article 19. Sans laisser croire à un soutien de l'Université du Minnesota ni de GroupLens.
- Jamais « Letterboxd » ni « IMDb » dans le nom ou le logo du site.

---

## 4. Sous-étapes

### G0 — Socle

- **Fichiers** : `web/src/styles/` (thème Tailwind, polices), `web/vite.config.ts`, `web/package.json` ; `docs/design-system.md` §3.
- **À faire** : installer Tailwind v4 (`tailwindcss`, `@tailwindcss/vite`) et les polices (`@fontsource/courier-prime`, `@fontsource/caveat`) ; installer l'environnement de tests de composants (`jsdom`, `@testing-library/react`, `@testing-library/user-event`), avec l'environnement `jsdom` seulement pour les fichiers `*.test.tsx`.
- **Critères** :
  - la page provisoire s'affiche avec les jetons et les polices ;
  - le build ne fait aucune requête vers `fonts.googleapis.com` (vérifié en G5) ;
  - les tests existants (125) restent verts.

### G1 — Titres corrigés (action `title`)

- **Fichiers** : `pipeline/manual_overrides.csv`, `pipeline/site_catalog.py`, `pipeline/tests/test_site_catalog.py` (et `test_manual_overrides.py` si la validation du CSV y est), `CLAUDE.md`.
- **Critères** :
  - action `title` validée (raison obligatoire, `movie_id` existant) et appliquée à `catalog.json` et `title-index.json` ;
  - tests ;
  - `export.py catalog --out web` puis `catalog-verify` OK.
- **Arrêt obligatoire** : liste proposée des titres à corriger (Nausicaä + relecture des titres divergents), validée par Thibault avant de l'écrire dans le CSV.

### G2 — Composants

- **Fichiers** : `web/src/components/` : `Layout` (en-tête, pied de page), `DropZone`, `HandNote` (annotation Caveat inclinée), `Underline`, `ArrowNote`, `PrimaryButton`, `NoList`, `FilmCard`, `FilmGrid`, `Slider`.
- **Critères** :
  - chaque composant a ses tests React Testing Library : rôle accessible, libellés, clavier, rotation déterministe de la carte, mention pépite à ≤ 1 000, lien Letterboxd, documentaire ;
  - zones tactiles ≥ 44 px.

### G3 — Accueil et analyse

- **Fichiers** : `web/src/pages/Accueil.tsx`, `Analyse.tsx`, `web/src/App.tsx`, `web/public/exemple/` (export synthétique : `ratings.csv` + `watched.csv` d'environ 60 films connus, notes inventées, en ZIP, avec au moins un titre ambigu et un titre approximatif pour exercer l'écran d'analyse) ; `web/src/reco/workerCore.ts`, `client.ts`, `web/src/matching/history.ts` (message `confirm`, statut `confirmed`, index des entrées dans `unrecognized`).
- **Critères** :
  - dépôt par clic, clavier et glisser-déposer ; exemple ; CSV IMDb → message ; fichier invalide → message ;
  - analyse : comptes justes, trop récents (≥ 2024) et hors catalogue séparés, choix des candidats ;
  - **test** : un candidat confirmé entre dans le fold-in, et un candidat non confirmé n'est jamais recommandé ;
  - `reco.test.ts` toujours vert (22 vecteurs, 66 listes).

### G4 — Recommandations et « à propos »

- **Fichiers** : `web/src/pages/Resultats.tsx`, `APropos.tsx`, `web/public/tmdb-logo.svg`.
- **Critères** :
  - un seul `recommend` pour les 8 positions ; changement de cran sans nouveau calcul ;
  - phrase du titre selon la position ; annotation de profil ; indicateur < 0,04 ; tampon pépite seulement si plafond > 1 000 ; filtre documentaires ; annotation « même série que » ; note sur les films récents ; « encore des films » (8 par 8, 48 au plus) ;
  - mentions TMDB et MovieLens exactes ;
  - liste des « spectacles » détectés par l'heuristique sur le catalogue, préparée pour G6 (dans le compte rendu : ce sont des titres du catalogue, pas de données personnelles).

### G5 — Tests dans un vrai navigateur (Playwright, Chromium seul)

- **Fichiers** : `web/playwright.config.ts`, `web/e2e/*.spec.ts` ; `@playwright/test` et `@axe-core/playwright` (développement) ; `npx playwright install chromium`.
- **Le test lance `vite preview`** sur le build. Il vérifie :
  - **parcours complet** avec l'export d'exemple : dépôt → analyse (une confirmation) → recommandations → curseur sur 3 crans → « encore des films » ;
  - **vue téléphone** (375 × 812) : une colonne, pas de défilement horizontal, « c'est là » sous la zone de dépôt ;
  - **réseau** : toutes les requêtes sont interceptées ; seules sont autorisées l'origine locale et `image.tmdb.org`. **Aucune requête vers Google** ni ailleurs ;
  - **stockage** : rien dans `localStorage`, `sessionStorage` ni IndexedDB après le parcours ;
  - **accessibilité** : axe-core sur les trois écrans et la page « à propos » ;
  - **temps** : modèle prêt, analyse de l'export d'exemple, changement de cran jusqu'à l'affichage ;
  - **captures** des trois écrans (bureau et téléphone) avec l'export d'exemple, dans `web/test-data/screenshots/` (ignoré).

### G6 — Contrôle avec l'export de Thibault, relecture

- `npm run dev`, avec l'export de Thibault (`web/test-data/exports/`) : parcours complet, captures montrées **à Thibault seulement**.
- **Lien Letterboxd** : vérifier à la main, sur 3 films, que `https://letterboxd.com/tmdb/<tmdb_id>/` redirige bien vers la fiche du film. Sinon : **arrêt**.
- Test sur un vrai téléphone : `npm run dev -- --host`, fait à la main par Thibault ; résultat noté en section 5.
- **Arrêt obligatoire** :
  - relecture (captures, temps, critères) ;
  - décision sur la mention « spectacle » ;
  - puis mise à jour de `CLAUDE.md` (étape 5 ✅, commandes `npm run …` et Playwright, retrait de la ligne « Étape en cours ») et de `stack-technique.md`, avec le diff montré avant le commit.

### Critères de réussite (récapitulatif)

| Critère | Seuil |
|---|---|
| Conformité au design system | jetons, polices, composants, mise en page et textes de la maquette identiques ; relecture visuelle par Thibault sur les captures |
| Accessibilité | vrais `<button>`, `<a>`, `<label>` et `<input>` ; tout se fait au clavier ; zones tactiles ≥ 44 px ; **0 violation axe-core « serious » ou « critical »** ; contraste AA |
| Téléphone (375 px) | une colonne, pas de défilement horizontal, « c'est là » sous la zone de dépôt |
| Confidentialité | aucune requête hors du site sauf `image.tmdb.org` ; aucune requête Google ; rien dans le stockage du navigateur |
| Parcours | test de bout en bout vert ; confirmés dans le fold-in ; non confirmés jamais recommandés |
| Moteur | `reco.test.ts` vert (22 vecteurs, 66 listes) |
| Temps (Chromium, machine de dev, cache vide, serveur local) | modèle prêt ≤ 2 s ; analyse de l'export d'exemple ≤ 300 ms ; changement de cran ≤ 50 ms jusqu'à l'affichage |
| Qualité | `tsc`, ESLint, Prettier, Vitest et Playwright verts ; `npm run build` OK |

---

## 5. Résultats

*À remplir à la fin de chaque sous-étape.*

### G0

Fait le 8 novembre 2026. Tous les critères sont atteints.

- **Tailwind CSS v4** (`tailwindcss`, `@tailwindcss/vite`). Jetons de D1 dans `@theme` (`web/src/styles/index.css`) :
  - couleurs `paper`, `white`, `ink`, `muted`, `rule`, `pen`, `tape` ; la palette par défaut de Tailwind est retirée (`--color-*: initial`), donc aucune autre couleur n'est possible par erreur ;
  - polices `font-mono` (Courier Prime) et `font-hand` (Caveat).
- **Polices auto-hébergées** : `@fontsource/courier-prime` (400, 700, 400 italique) et `@fontsource/caveat` (500, 700).
  - On importe les fichiers par graisse, qui déclarent chaque sous-ensemble avec un `unicode-range` : le navigateur ne télécharge que ce qu'une page utilise (latin ; latin-ext pour un titre polonais, par exemple).
  - Les fichiers `latin-*.css` ont été écartés : ils n'ont pas d'`unicode-range`, et les combiner avec latin-ext aurait masqué le latin de base.
  - `docs/design-system.md` §3 : le lien Google Fonts est remplacé par les paquets.
- **Tests de composants** : `jsdom`, `@testing-library/react`, `@testing-library/user-event` et `@testing-library/dom`.
  - Vitest est découpé en deux projets : `node` (`*.test.ts`) et `dom` (`*.test.tsx`, jsdom). `environmentMatchGlobs` n'existe plus dans Vitest 5.
  - Test de fumée : `src/styles/theme.test.tsx`.
- **Vérifications** :
  - page provisoire rendue dans Edge sans interface : fond papier, Courier Prime, annotation Caveat en stylo bleu ;
  - `dist/` ne contient aucune référence à `googleapis` ; la vérification réseau dans un vrai navigateur reste prévue en G5 ;
  - Vitest 126/126 (les 125 tests existants + le test de fumée) ; `tsc`, ESLint et Prettier verts ; `npm run build` OK (CSS de 2,4 Ko gzip, hors polices).

### G1

Code fait le 8 novembre 2026 ; **en attente de la validation de la liste des titres** (arrêt prévu).

- **Action `title`** :
  - `manual_overrides.csv` reçoit une colonne `title` (vide pour `exclude` et `merge_into`) ;
  - validation dans `build_catalog.load_manual_overrides` : titre non vide pour `title`, colonne `title` interdite pour les autres actions, `target_movie_id` réservé à `merge_into`, raison obligatoire, une ligne par `movie_id` ;
  - `site_catalog.title_overrides` refuse un `movie_id` absent du catalogue (exclu ou fusionné dans un autre) ;
  - le titre manuel remplace le titre affiché dans `catalog.json` ; sa clé entre dans `title-index.json` en source 0, et la clé du titre TMDB est gardée (un export qui utilise l'ancien titre reste reconnu) ;
  - `build_catalog.py`, le modèle et `catalog.parquet` ne sont pas touchés.
- **Contrôles** :
  - `export.py catalog-verify` vérifie aussi que chaque titre manuel est affiché et indexé en source 0 ;
  - `title_fixtures.py catalog-keys` ajoute les titres manuels aux cas du test TypeScript exhaustif.
- **Première ligne écrite** : Nausicaä (`movie_id` 7099, TMDB 81), décidée en D7.
- **Résultats** :
  - pytest 231/231 (+ 3 tests `site_catalog`, + 1 test de lecture, + 4 cas de fichier invalide) ; `ruff` vert ;
  - `export.py catalog` et `catalog-verify` OK, pour la relecture comme pour `web` : 23 019 films, 34 723 clés, `manual_titles_not_applied` vide, 3,06 Mo gzip au total ;
  - Vitest 126/126 avec le nouveau catalogue.
- **Relecture des titres divergents** (titre TMDB différent de tous les titres MovieLens et du titre original : 728 films, dont 8 à ≥ 2 000 notes et 20 à ≥ 1 000) :
  - à ≥ 1 000 notes, un seul titre est faux : « Warriors of the Wind ». Les 19 autres sont les titres anglais d'usage (*The Intouchables*, *Oldboy*, *Castle in the Sky*, *The Raid*, *Police Story 3: Super Cop*, *Arrietty*, *District B13*, *Fantastic Planet*, *Mirror*, *Children of Heaven*…) ;
  - une recherche en plus, sur tout le catalogue, des titres affichés en écriture non latine ou tout en majuscules fait ressortir 4 cas douteux (moins de 300 notes chacun) : voir la liste proposée.
- **Liste proposée à Thibault** (seul Nausicaä est déjà écrit) :

  | movie_id | TMDB | titre affiché aujourd'hui | proposé | raison |
  |---|---|---|---|---|
  | 7099 | 81 | Warriors of the Wind | Nausicaä of the Valley of the Wind | ancien montage américain (D7) |
  | 2292 | 25723 | 愛情快遞 | Overnight Delivery | film américain (langue originale `en`) ; TMDB n'a qu'un titre chinois |
  | 40337 | 15083 | האושפיזין | Ushpizin | titre en hébreu seulement ; le film est sorti sous le nom *Ushpizin* |
  | 243208 | 638597 | YES DAY | Yes Day | capitales TMDB ; MovieLens écrit « Yes Day » |
  | 211966 | 528491 | WHAT DID JACK DO? | *(à trancher)* What Did Jack Do? | capitales voulues par Lynch ? à garder si oui |

  Les autres titres en capitales sont des graphies voulues (*WALL·E*, *C.R.A.Z.Y.*, *BLAME!*, *GANTZ:O*…) et ne sont pas proposés.

### G2
### G3
### G4
### G5
### G6

---

## 6. À reporter

*(Y noter ce qui est vu pendant l'étape et relève d'une étape suivante.)*

- **Seuil de l'indicateur « loin de tes goûts »** (D5, 0,04) : à recalibrer avec les exports des volontaires (étape 7), d'après la distribution des scores relatifs par position et le ressenti (liste cohérente ou non).
