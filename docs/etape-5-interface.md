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

Fait le 8 novembre 2026. Liste des titres validée par Thibault le même jour (les 5 lignes proposées).

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
- **Liste validée par Thibault et écrite dans `manual_overrides.csv`** :

  | movie_id | TMDB | titre affiché aujourd'hui | proposé | raison |
  |---|---|---|---|---|
  | 7099 | 81 | Warriors of the Wind | Nausicaä of the Valley of the Wind | ancien montage américain (D7) |
  | 2292 | 25723 | 愛情快遞 | Overnight Delivery | film américain (langue originale `en`) ; TMDB n'a qu'un titre chinois |
  | 40337 | 15083 | האושפיזין | Ushpizin | titre en hébreu seulement ; le film est sorti sous le nom *Ushpizin* |
  | 243208 | 638597 | YES DAY | Yes Day | capitales TMDB ; MovieLens écrit « Yes Day » |
  | 211966 | 528491 | WHAT DID JACK DO? | What Did Jack Do? | capitales TMDB ; casse normale (choix de Thibault) |

  Les autres titres en capitales sont des graphies voulues (*WALL·E*, *C.R.A.Z.Y.*, *BLAME!*, *GANTZ:O*…) et ne sont pas proposés.
- **Après validation** : `export.py catalog` (relecture et `web`) puis `catalog-verify` OK, avec 5 titres manuels et `manual_titles_not_applied` vide ; `catalog_title_keys.json` régénéré ; pytest 231/231 ; Vitest 126/126.

### G2

Fait le 8 novembre 2026. Tous les critères sont atteints.

- **Composants** (`web/src/components/`) :
  - `Layout` : en-tête avec le logo, « (nom provisoire) » et la navigation (« comment ça marche » → `#comment-ca-marche`, « qui on est » → `#a-propos`) ; sur les résultats, « ← changer de fichier » est un vrai `<button>` ; pied de page avec les deux mentions ; colonne de 820 ou 1 100 px ;
  - `DropZone` : `<label>` lié à `<input type="file" accept=".zip,.csv">` (masqué visuellement mais focalisable, contour stylo bleu au focus), glisser-déposer, flèche « c'est là » qui passe sous la zone quand la place manque ;
  - `HandNote`, `Underline`, `ArrowNote`, `PrimaryButton` (48 px), `NoList` ;
  - `FilmCard`, `FilmGrid` (`<ul>` « films recommandés »), `Slider`.
- **Règles de la carte** (`cardRules.ts`, hors des composants pour être testées seules) :
  - rotation tirée de `item_idx` seul, dans [−1,8° ; +1,8°] ; scotch dans [−4° ; +4°] ;
  - tampon « ✱ pépite » si popularité ≤ 1 000 **et** plafond > 1 000 (∞ compris), comme ajusté en D6 ;
  - lien `https://letterboxd.com/tmdb/<tmdb_id>/`, nouvel onglet, `rel="noopener noreferrer"`, avec un texte pour lecteur d'écran « (s'ouvre sur letterboxd, dans un nouvel onglet) » ; sans `tmdb_id`, la carte n'est pas un lien ;
  - « réalisateur, année » : deux réalisateurs au plus, joints par « et » ;
  - « documentaire » si le genre MovieLens « Documentary » est présent ;
  - annotation « (même série que « X », que t'as vu) » si la page la fournit.
- **`FilmCard` du moteur** : deux champs d'affichage en plus, `tmdbId` et `genres` (noms MovieLens), lus dans `catalog.json` par `workerCore.filmCard`. Le calcul n'est pas touché, et `reco.test.ts` reste vert.
- **Tests** : `components.test.tsx`, 24 tests (rôles accessibles, libellés, clavier, rotation déterministe, tampon, lien Letterboxd, documentaire, affiche ou cadre uni, série, curseur).
  - Configuration jsdom : `@testing-library/jest-dom` et un nettoyage entre les tests (`src/test/setupDom.ts`).
  - Le test de fumée de G0 est retiré, puisque ces tests le remplacent.
  - Vitest 149/149 ; `tsc`, ESLint, Prettier et le build verts.
- **Limites des tests** :
  - jsdom ne simule ni les flèches du clavier sur un `<input type="range">` ni la mise en page ;
  - les zones tactiles ≥ 44 px sont donc vérifiées ici par les classes (`h-11`, `h-12`, `min-h-11`) ;
  - le clavier sur le curseur et les mesures réelles se feront dans Playwright (G5).

### G3

Fait le 8 novembre 2026. Tous les critères sont atteints.

- **Moteur** (toujours un seul moteur, `reco.test.ts` vert) :
  - nouveau statut `confirmed` (`match.ts`), ajouté à `RECOMMENDATION_STATUSES` ;
  - `engine.applyChoices(matched, choices)` : un candidat choisi devient `confirmed` et entre dans le fold-in ; « aucun de ceux-là » (`null`) ou l'absence de choix laisse l'entrée telle quelle, avec ses exclusions ;
  - seules les entrées `ambiguous` et `probable_fuzzy` acceptent un choix, et le film doit être un de leurs candidats (sinon erreur) ;
  - un `ambiguous` confirmé n'exclut plus que le film choisi.
- **Worker** :
  - message `confirm` (`RecoClient.confirm(choices)`, renvoie les comptes et `nHistoryFilms`) ;
  - les choix s'appliquent toujours à l'import d'origine, donc un nouvel envoi remplace les précédents ;
  - `unrecognized[]` porte l'`index` de l'entrée.
- **Pages** :
  - `App` : machine à états `accueil` → `analyse` → `resultats`, `init` dès l'arrivée (une seule fois, même avec StrictMode), aucun stockage ;
  - `Accueil` : textes de la maquette, aide dépliable (vrai bouton avec `aria-expanded`) ;
  - `Analyse` : sections décrites ci-dessous ;
  - `Resultats` : version minimale (curseur et 8 cartes), complétée en G4.
- **Écran d'analyse** :
  - titre « on a lu tes N films. on en a reconnu M. », où M suit les choix en direct ;
  - « à vérifier » : un `<fieldset>` par entrée, boutons radio avec miniature (w92), titre et « réalisateur, année », plus « aucun de ceux-là » ; rien n'est coché ;
  - « trop récents » (≥ 2024) et « pas dans notre catalogue » : listes dépliables (`<details>`), avec le singulier quand N = 1 ;
  - un `probable_fuzzy` sans candidat passe dans « pas dans notre catalogue ».
- **Lecture du fichier** (`readUpload.ts`) :
  - `.zip` → octets ; `.csv` → texte ;
  - CSV IMDb (colonnes `Const` + `Your Rating` ou `Title Type`, BOM toléré) → « les exports imdb arrivent bientôt. » ;
  - watchlist → message dédié ;
  - autre extension, ZIP illisible ou export sans entrée → « hmm, ça ressemble pas à un export letterboxd. » ;
  - aucun film reconnu et rien à vérifier → « on n'a reconnu aucun de tes films… », et on reste sur l'accueil.
- **Export d'exemple** : `web/public/exemple/letterboxd-exemple.zip` (2,8 Ko), généré par `npm run make-example` (`scripts/make-example.ts`, données en clair dans le script).
  - 66 films connus, notes inventées ;
  - 61 `exact`, 1 `ambiguous` (*Milk*, 2008 : le film de Gus Van Sant et un film turc de 2009), 1 `probable_fuzzy` (« Dr. Strangelove », forme courte du titre complet), 2 sortis en 2024 (*Anora*, *The Substance*), 1 série (*Chernobyl*) ;
  - 3 films vus sans note.
- **Tests** : Vitest 168/168 (+ 19) ; `tsc`, ESLint, Prettier et le build verts.
  - `confirm.test.ts` : `applyChoices` (pur) et, sur les vrais fichiers avec l'export d'exemple, la vérification exigée par G3.
    - Sans choix, aucun candidat de *Milk* ni de « Dr. Strangelove » n'est recommandé, à aucune des 8 positions (48 films chacune).
    - Après confirmation de *Milk* : historique + 1, scores du fold-in modifiés, *Milk* n'est plus recommandé (vu), et les candidats de « Dr. Strangelove » (« aucun de ceux-là ») restent exclus.
  - `pages.test.ts(x)` :
    - `readUpload`, regroupements et phrases ;
    - `Analyse` : rien de coché, choix envoyés par index ;
    - `App` avec un faux worker : dépôt par clic et par glisser-déposer, attente « on prépare nos fiches… », CSV IMDb, fichier illisible, aucun film reconnu, aide ;
    - `App` sur les vrais fichiers : exemple → analyse (66 lus, 61 reconnus) → confirmation → 8 cartes.
- **Vérifié dans Edge sans interface** : accueil fidèle à la maquette en bureau. La vue téléphone à 375 px n'est pas mesurable ainsi (largeur de fenêtre minimale d'Edge) : elle sera vérifiée avec Playwright en G5.

### G4

Fait le 8 novembre 2026. Tous les critères sont atteints. La liste des « spectacles » est prête pour G6.

- **Résultats** (`Resultats.tsx`) : les 8 positions viennent d'**un seul** `recommend({ n: 48 })`, appelé après l'analyse. Le curseur, le filtre et « encore des films » ne font que changer la liste affichée, sans nouveau calcul (le test `App` vérifie un seul appel).
  - Départ au cran 2 000.
  - Phrase du titre selon le cran (∞ / 20 000 / 10 000 → classiques ; 5 000 / 2 000 → mélange ; 1 000 / 500 / 200 → « voilà huit films… »). Le nombre suit les cartes affichées, en toutes lettres (« seize », « quarante-huit »), au singulier pour 1.
  - Indicateur « loin de tes goûts » sous le curseur si le score relatif est < 0,04.
  - Case « sans les documentaires » : filtre côté client de la liste déjà calculée.
  - « encore des films » : + 8 cartes, jusqu'à 48 ; le bouton disparaît ensuite.
  - Note sur les films récents sous la grille, annotation « dis-nous si on s'est planté, ça nous aide ».
  - Région `aria-live` masquée : « 8 films, moins de 2 000 notes ».
- **Annotations calculées dans le worker** (`reco/annotations.ts`, fonctions pures, sans effet sur les scores ; `RecommendResult` reçoit `profileDirectors` et `films[].seriesOf`) :
  - **profil** : réalisateurs les plus fréquents parmi les films du fold-in **notés** au-dessus de la médiane (percentile > 0,5). Égalités départagées par la somme des percentiles, puis par le nom ; 3 au plus ; masqué s'il en reste moins de 2.
    - Précision ajoutée : un réalisateur doit avoir **au moins 2 films** aimés, car « t'aimes bien X » sur un seul film sonne faux.
    - Noms complets en minuscules (« andrei tarkovsky, wim wenders et wong kar-wai ») : couper au nom de famille se tromperait sur les noms asiatiques (*Wong Kar-wai*, *Bong Joon-ho*).
  - **même série** : même titre principal (avant « : » ou « - », normalisé `titles-v2`) et au moins un réalisateur en commun avec un film de l'historique.
- **« à propos »** (`APropos.tsx`), ouverte par `#a-propos` (« qui on est ») ou `#comment-ca-marche` par-dessus l'écran en cours, qui est gardé : le logo ramène aux résultats.
  - Contenu : qui on est, comment ça marche, on garde rien (dont la phrase sur les affiches de TMDB), ce qu'on sait pas faire, « compatible avec les exports Letterboxd et IMDb. » (avec « (pour imdb, ça arrive bientôt) »).
  - Mentions : logo TMDB officiel (`web/public/tmdb-logo.svg`, fichier d'origine non modifié, téléchargé depuis themoviedb.org, sans script) + phrase TMDB exacte ; citation MovieLens exacte ; « pépite n'est ni soutenu ni approuvé par l'université du minnesota, grouplens ou tmdb. ».
- **Sur l'export d'exemple** (vrais fichiers, *Milk* confirmé, 62 films dans l'historique) :
  - profil : Tarkovsky, Wenders, Wong Kar-wai ;
  - *Kill Bill: Vol. 2* annoté « même série que *Kill Bill: Vol. 1* » ;
  - *Nausicaä of the Valley of the Wind* affiché avec le titre corrigé (G1) ;
  - scores relatifs : 1 / 0,70 / 0,55 / 0,39 / 0,27 / 0,18 / 0,11 / 0,049 de ∞ à 200, donc pas d'indicateur « loin de tes goûts » pour cet exemple ;
  - au cran 2 000, aucune des 8 premières cartes n'a de tampon : leur popularité est entre 1 000 et 2 000.
- **« Spectacles »** (D6, à trancher en G6) : `src/reco/spectacle.ts` (pas encore utilisé par l'interface), `npm run spectacles`, liste complète dans `docs/figures/etape-5-spectacles.md`.
  - 931 titres de la forme « Prénom Nom: … », dont **246** avec le seul genre « Comedy ».
  - Relecture à la main des 56 plus populaires : **34 vrais spectacles, 22 non (61 %)**. Les erreurs sont des suites ou des films à personnage (*Ace Ventura: Pet Detective*, *Robin Hood: Men in Tights*, *Deuce Bigalow: Male Gigolo*, *Alan Partridge: Alpha Papa*, *Borat Subsequent Moviefilm*…), et elles occupent 7 des 8 premières places.
  - La règle ne peut pas distinguer un nom de personnage d'un nom d'humoriste. Recommandation pour G6 : ne pas afficher la mention, et la reporter à l'enrichissement TMDB (genres ou mots-clés « stand-up »).
- **Tests** : Vitest 186/186 (+ 18 : textes, annotations, `Resultats`, « à propos », route) ; `tsc`, ESLint, Prettier et le build verts.
  - `pages.test.ts` renommé en `helpers.test.ts` : avec le même nom que `pages.test.tsx`, tsc ne vérifiait pas le fichier `.tsx`.
  - Le test de temps du matcher (étape 3 : 3 000 entrées ≤ 300 ms) échouait dans la suite complète (1,5 s), à cause des nouveaux fichiers de test qui chargent le vrai moteur en parallèle. Seul, il passe. Il tourne maintenant dans un projet Vitest `timed`, après les autres (`sequence.groupOrder`), avec le même seuil.

### G5

Fait le 8 novembre 2026. Tous les critères sont atteints.

- **Outils** : `@playwright/test` 1.65 (Chromium seul), `@axe-core/playwright` ; `web/playwright.config.ts` lance `npm run build` puis `vite preview` (port 4173), un seul worker pour des temps fiables. Commande : `npm run e2e`. Tests dans `web/e2e/` ; sorties dans `web/test-data/playwright/` et `web/test-data/screenshots/` (ignorés).
- **Marques de performance** dans `App` (`pepite:model-ready`, `pepite:import-start`, `pepite:import-end`) : `performance.mark` seulement, rien de stocké ni d'envoyé.
- **4 tests, tous verts** :
  1. **parcours complet** avec l'export d'exemple : accueil → analyse (66 lus, 61 reconnus, *Milk* confirmé → 62) → résultats (départ au cran 2 000, 8 cartes, profil) → curseur sur 3 crans **au clavier** (→, →, Début ; un premier film différent à chaque cran, phrase du titre juste, rien d'affiché à ∞) → « encore des films » (16 cartes) → lien Letterboxd de la carte (`href`, `target`, `rel`) → « à propos » ;
  2. **zone de dépôt** : atteinte au clavier (4ᵉ tabulation), CSV IMDb → « les exports imdb arrivent bientôt. », puis le ZIP d'exemple déposé comme un vrai fichier ;
  3. **téléphone** (375 × 812, tactile) : pas de défilement horizontal sur les trois écrans, « c'est là » sous la zone de dépôt, une seule colonne de cartes, toutes les zones tactiles ≥ 44 px (boutons, liens, curseur, cases ; le test a trouvé le logo à 33 px, corrigé) ;
  4. **temps** (voir ci-dessous).
- **Réseau** : toutes les requêtes sont interceptées ; seules passent l'origine locale et `image.tmdb.org`. Résultat : **aucune requête bloquée** (donc aucune vers Google ni ailleurs), des requêtes d'affiches vers `image.tmdb.org`.
- **Stockage** après le parcours : `localStorage` 0, `sessionStorage` 0, IndexedDB 0 base, aucun cookie.
- **Accessibilité** : axe-core sur l'accueil, l'analyse, les résultats et « à propos » : **0 violation « serious » ou « critical »**.
- **Temps** (Chromium sans interface, machine de dev, contexte neuf donc cache vide, serveur local ; deux exécutions) :

  | Mesure | Seuil | Mesuré |
  |---|---|---|
  | modèle prêt (depuis la navigation) | ≤ 2 s | 774 ms ; 870 ms |
  | analyse de l'export d'exemple (import dans le worker, aller-retour) | ≤ 300 ms | 11 ms ; 14 ms |
  | changement de cran jusqu'à l'affichage (7 crans, 2 images après le changement du DOM) | ≤ 50 ms | 34 ms au pire ; 40 ms au pire |

  Le changement de cran est sous le seuil mais sans grande marge : il est dominé par le rendu de la grille et des images (le calcul est déjà fait).
- **Captures** (export d'exemple seulement) : `web/test-data/screenshots/` : `1-accueil`, `2-analyse`, `3-resultats`, `4-a-propos` (bureau) et `1-accueil-telephone`, `2-analyse-telephone`, `3-resultats-telephone`. Relues : conformes à la maquette.
- **Qualité** : Vitest 186/186, Playwright 4/4, `tsc` (qui couvre maintenant `e2e/` et `playwright.config.ts`), ESLint, Prettier, build verts.

### G6

Contrôle fait le 8 novembre 2026. **Arrêt obligatoire : relecture de Thibault en cours.**

- **Export de Thibault dans la vraie interface** (`vite preview` sur le build, Chromium piloté par un script non versionné dans `web/test-data/` ; ZIP refait avec `ratings.csv`, `watched.csv` et `diary.csv` seulement, jamais `profile.csv`). Taux et comptes seulement, aucun titre :
  - 225 entrées lues, **188 reconnues**, comme à l'étape 3 ;
  - 2 entrées « à vérifier » : deux séries rapprochées d'un film par le flou. Rien n'est coché, et « aucun de ceux-là » les règle : c'est le cas qui justifie de ne jamais prendre le flou automatiquement ;
  - 25 sorties après 2023 et 10 hors catalogue (séries, 2023 sous le seuil, absents de MovieLens) ;
  - annotation de profil affichée (3 réalisateurs) ;
  - annotation « même série que » vue une fois au cran 500 ;
  - pas d'indicateur « loin de tes goûts » au cran 500, cohérent avec le score relatif mesuré à l'étape 4 (0,05 > 0,04) ;
  - **tampon « ✱ pépite » : 0 carte** parmi les 8 premières aux crans 2 000 et ∞ (voir la décision ci-dessous) ;
  - bureau et téléphone (375 px) : pas de défilement horizontal, aucune requête hors de l'origine locale et de `image.tmdb.org` ;
  - temps : modèle prêt en 924 ms (bureau) et 595 ms (téléphone), analyse en 30 et 19 ms ;
  - captures dans `web/test-data/screenshots/thibault/` (ignoré), montrées à Thibault seulement.
- **Lien Letterboxd** : `https://letterboxd.com/tmdb/<tmdb_id>/` vérifié sur 3 films du catalogue. TMDB 1398, 81 et 670 redirigent (1 redirection, code 200) vers `/film/stalker/`, `/film/nausicaa-of-the-valley-of-the-wind/` et `/film/oldboy/`. Critère tenu.
- **Test sur un vrai téléphone** (`npm run dev -- --host`) : à faire à la main par Thibault ; résultat à noter ici.
- **Décisions demandées à Thibault** :
  1. mention « spectacle » : recommandation de ne pas l'afficher (61 % de précision sur les 56 plus populaires, voir G4) et de la reporter à l'enrichissement TMDB ;
  2. tampon « ✱ pépite » : avec la règle ajustée (popularité ≤ 1 000 et plafond > 1 000), il n'apparaît presque jamais. Aux crans ∞ à 2 000, les premiers films sont tous au-dessus de 1 000. 0 carte tamponnée sur les 8 premières au cran 2 000, avec l'export d'exemple comme avec celui de Thibault. À garder tel quel, ou à revoir (par exemple : tamponner au cran courant les films sous le plafond suivant) ;
  3. relecture visuelle des captures.
- Après la relecture : mise à jour de `CLAUDE.md` et de `stack-technique.md`, avec le diff montré avant le commit.

---

## 6. À reporter

*(Y noter ce qui est vu pendant l'étape et relève d'une étape suivante.)*

- **Tampon « ✱ pépite »** (D6) : presque jamais visible avec la règle ajustée (voir G6, décision 2).
- **Mention « spectacle »** : heuristique sur les titres trop imprécise (61 %) ; à refaire avec les genres ou mots-clés TMDB (enrichissement du pipeline).
- **Changement de cran** : 34 à 40 ms au pire pour un seuil de 50 ms, dominé par le rendu. À surveiller si les cartes s'enrichissent.
- **Seuil de l'indicateur « loin de tes goûts »** (D5, 0,04) : à recalibrer avec les exports des volontaires (étape 7), d'après la distribution des scores relatifs par position et le ressenti (liste cohérente ou non).
