# Feuille de route

> Mise à jour le 8 novembre 2026, à la clôture de l'étape 5. Ordre des étapes : `docs/stack-technique.md` §8.
> Renvois : `é2` à `é5` = `docs/etape-2-modele.md`, `docs/etape-3-letterboxd.md`, `docs/etape-4-navigateur.md`, `docs/etape-5-interface.md` (§6 = « À reporter » ou questions ouvertes).

## Prochaine étape à lancer : 6, adaptateur IMDb

Spec `docs/etape-6-imdb.md` v0.2 **validée** le 8 novembre 2026 (repli par titre toujours dans « à vérifier »). G1-G3 faits sur fixtures synthétiques. G0 fait sur un export IMDb fabriqué par Thibault : `Title Type` est traduit dans la langue du compte (`Film`, `Série télévisée`) ; corrigé en **v0.3** (repli refusé seulement aux types non-films connus, anglais et français ; type inconnu = film). Second export (libellé `Épisode télévisé` ajouté) et watchlist réelle (bien détectée comme liste) traités. En attente : libellés français de mini-série et de jeu (absents de l'export), la vérification du fichier de contrôle par Thibault, le chemin exact de l'export sur imdb.com pour l'aide de l'accueil. G4 : rapport de bout en bout seulement, mesure des taux reportée. L'étape 7 (mise en ligne) reste bloquée par GroupLens. L'étape 6 ne l'est pas.

## Étapes restantes

### 6. Adaptateur IMDb

- **Objectif** : accepter le CSV des notes IMDb et donner le même format interne que Letterboxd. Jusqu'ici, l'interface répond « les exports imdb arrivent bientôt ». Le rapprochement se fait d'abord par `imdb_id` (`tt…`, issu de MovieLens `links.csv`, avec les `imdb_id_aliases` de `catalog.json`), puis par titre + année en repli.
- **Dépendances** : `catalog.json`, qui contient déjà `imdb_id` et ses alias ; l'architecture d'adaptateurs (`web/src/adapters/`) ; un vrai export IMDb.
- **Questions ouvertes** :
  - colonnes exactes de l'export actuel (`Const`, `Your Rating`, `Date Rated`, `Title`, `Title Type`… ; à vérifier sur un vrai fichier) ;
  - traitement des `Title Type` qui ne sont pas des films (séries, épisodes, jeux) : les écarter avant le rapprochement, ou les compter dans « pas dans notre catalogue » ;
  - accepter aussi l'export de la watchlist ou des listes IMDb, ou seulement celui des notes ;
  - notes de 1 à 10 : la conversion en percentiles est déjà commune ;
  - export qui mélange Letterboxd et IMDb : non prévu.
- **Rappel de licence** : le fichier IMDb de l'utilisateur est permis, puisqu'il est lu dans son navigateur. Rien des datasets IMDb ne doit être embarqué.

### 7. Mise en ligne et tests avec 10 à 20 cinéphiles

- **Objectif** :
  - publier le site sur Cloudflare Pages ou GitHub Pages ;
  - lancer le rafraîchissement mensuel des métadonnées TMDB par GitHub Actions ;
  - faire tester par 10 à 20 volontaires, avec la question clé : « combien de ces films ne connaissais-tu pas et as-tu envie de voir ? ».
- **Dépendances** :
  - **la réponse de GroupLens**, bloquante pour la mise en ligne et le versionnement de `web/public/data/` ;
  - la clé TMDB dans les secrets GitHub ;
  - les étapes 5 et 6.
- **Questions ouvertes** :
  - hébergeur (Cloudflare ou GitHub Pages) et nom de domaine ;
  - nom définitif du site ;
  - forme du retour des volontaires : lien « dis-nous si on s'est planté », formulaire, ou boutons « ça me tente / pas pour moi » sans stockage côté serveur ;
  - cache du modèle (IndexedDB ou cache HTTP seul) ;
  - en-têtes de cache et de sécurité de l'hébergeur ;
  - que faire si GroupLens refuse ou impose des conditions.

### 8. Ensuite

- **Fiche film** : retirée de l'étape 5. Pour l'instant, la carte renvoie vers Letterboxd. Il faut choisir le contenu (résumé TMDB ? casting ? films proches ?) et vérifier ce que TMDB permet d'embarquer.
- **Explications** : « recommandé parce que tu as aimé X, Y, Z », à partir des films de l'historique dont les vecteurs sont les plus proches. Le calcul est déjà possible dans le moteur. Reste à décider le nombre de films cités et le niveau de confiance.
- **Dispo en France** : à partir des *watch providers* TMDB (région FR), précalculés chaque mois et ajoutés à `catalog.json`. Il faut vérifier les conditions TMDB et l'attribution JustWatch.
- **Listes faites main** : texte libre rapproché par Fuse.js, puis une IA via un Cloudflare Worker avec une limite d'usage. À trancher : coût, garde-fous, et ce qu'on envoie à l'API (des titres, jamais rien de personnel).
- **Scraping Letterboxd par pseudo** : option secondaire seulement, puisque c'est contraire aux conditions de Letterboxd. Il faudrait un Worker, à cause de CORS.
- **Autres imports** : SensCritique, Trakt, Criticker, un adaptateur chacun.

## Points « à reporter » des specs, par étape cible

### Étape 6 (IMDb)

- Mesurer les mêmes taux de correspondance qu'à l'étape 3 sur un vrai export IMDb (`é3` §6). **Reporté** (`é6` §5 G4, §6) : l'export de Thibault (~40 titres, compte créé pour l'occasion) est trop petit et fabriqué. À faire sur l'export d'un proche si possible, sinon à l'étape 7 avec les volontaires.
- Ids inventés `tt99000001`-`tt99000005` de `imdb-exemple.csv` : à revérifier, IMDb pourrait les attribuer un jour (`é6` §6).

### Étape 7 (mise en ligne, volontaires)

- **Seuil « loin de tes goûts »** (0,04) : le recaler d'après la distribution des scores relatifs par cran et le ressenti des volontaires (`é5` §6).
- **Tampon « ✱ pépite »** : il est visible à ∞ mais presque jamais aux crans bas, parce que le plafond resserre les popularités. Il faudra peut-être un seuil plus doux, par exemple deux tiers de la médiane (`é5` §6, G6).
- **Correspondance sur les exports des volontaires** : mêmes taux qu'à l'étape 3, en particulier la précision de `probable_variant`, qui n'avait aucun cas dans le premier export. Taux seulement, fichiers supprimés ensuite (`é3` §6).
- **Correspondance IMDb sur un vrai historique** (si aucun proche n'a fourni d'export avant) : reconnus par id, échecs, précision par id, part d'homonymes parmi les candidats par titre ; taux seulement (`é6` §6).
- **Évaluation sur de vrais historiques Letterboxd** : les exports des volontaires, sans dataset scrapé (`é2` §6).
- **Formulaire de retour** derrière « dis-nous si on s'est planté » (`é5` D5).
- **Cache du modèle** : IndexedDB éventuellement (`é4` D1).
- **Changement de cran** : 34 à 40 ms au pire, pour un seuil de 50 ms. À surveiller si les cartes s'enrichissent (`é5` §6).

### Plus tard (pipeline, données)

- **Mention « spectacle »** (stand-up) : la refaire avec les genres ou mots-clés TMDB, via un champ ajouté par `enrich_tmdb.py` puis `catalog.json`. La règle sur les titres est écartée (`é5` §6).
- **Seuil ≥ 10 notes** (catalogue plus grand) : optionnel, pas fait (`é2` D9).
- Pas de réentraînement périodique : MovieLens 32M est figé. Seules les métadonnées TMDB sont rafraîchies (`é2` §6).

## Idées « plus tard »

- **Films sortis après 2023** : un modèle de contenu (genres, mots-clés, réalisateur, résumé TMDB, éventuellement des embeddings de texte calculés hors ligne) pour combler le trou de MovieLens. Aujourd'hui, ces films sont seulement signalés.
- **Enrichissement des genres TMDB** : pour les spectacles, de meilleurs filtres et la calibration.
- **Recalage avec les volontaires** : seuil « loin de tes goûts » et tampon « ✱ pépite » (voir plus haut).
- **Feedback « ça me tente / pas pour moi »** sur les cartes : il mesure la qualité perçue. Il faut une solution sans compte ni données personnelles.
- **Blocage** d'un film recommandé, pour qu'il ne revienne pas. Il faudrait un stockage local, donc une décision.
- **Calibration** : respecter les proportions du profil (genres, décennies, pays).
- **Filtres** : durée, décennie, pays, langue, genre.
- **« Comme ce film »** : partir d'un seul film. **Partir d'une liste ou d'une watchlist.**
- **Profil cinéphile façon « Wrapped »** : réalisateurs, pays, décennies, part de pépites.
- **Mode à deux** : fusionner deux historiques.
- **Transition douce** près du plafond du curseur.
- **Modèle séquentiel** (SASRec, ONNX Runtime Web) qui tient compte de l'ordre du journal.
- **« Quel abonnement prendre pour voir ma watchlist ? »**, une suite de la dispo en France.
