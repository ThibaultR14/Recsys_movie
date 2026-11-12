# Décisions

> Toutes les décisions prises du 6 au 8 novembre 2026 (étapes 1 à 6b), une ligne chacune : décision — raison — où c'est détaillé. Les décisions **écartées** importantes sont marquées ✗.
> Abréviations : `projet` = `docs/projet-reco-films.md`, `stack` = `docs/stack-technique.md`, `é2` à `é6` = `docs/etape-2-modele.md` … `docs/etape-6-imdb.md`, `é6b` = `docs/etape-6b-retouches.md`, `é6c` = `docs/etape-6c-qualite.md`, `é8` = `docs/etape-8-films-recents.md`, `DS` = `docs/design-system.md`.

## Données et licences

- **MovieLens 32M** comme base d'entraînement — gros, propre, notes explicites — `stack` §2.
- **Catalogue : films avec ≥ 20 notes MovieLens** (23 019 films) — garder la longue traîne (les pépites) en restant vers 5 Mo — `projet` §9, `stack` §3.
- Séries et épisodes retirés, doublons fusionnés, films en désaccord avec TMDB gardés pour l'entraînement mais `recommendable = false` — catalogue propre sans perdre de signal — `stack` §3.
- Corrections manuelles **uniquement** dans `pipeline/manual_overrides.csv` (`exclude`, `merge_into`, `title`), avec une raison — traçable, jamais en dur dans le code — `CLAUDE.md`, `é5` D7.
- Action `title` : 5 titres affichés corrigés (dont un ancien titre de remontage américain), appliqués par `site_catalog.py` seulement — le modèle et le catalogue d'entraînement ne bougent pas — `é5` D7, G1.
- **Datasets IMDb hors ligne seulement** (jointures, contrôles), colonnes préfixées `imdbds_` et jamais écrites dans `web/public/data/` — licence IMDb — `CLAUDE.md`.
- TMDB pour les métadonnées (titres, réalisateurs, affiches, votes) ; le site n'appelle jamais l'API, seules les affiches viennent de `image.tmdb.org` — pas de clé dans le navigateur, rien de personnel envoyé — `stack` §5.
- **Usage non commercial** : ni pub, ni fonction payante, ni lien affilié, ni dons sans accord — licences MovieLens, TMDB et IMDb — `projet` §6.
- Mentions obligatoires sur « à propos » (logo et phrase TMDB, citation MovieLens), et une phrase honnête sur les affiches — conditions TMDB et GroupLens — `é5` D8.
- Ni « Letterboxd » ni « IMDb » dans le nom ou le logo ; « compatible avec les exports… » est permis — marques — `CLAUDE.md`.
- Contact direct avec GroupLens et TMDB ; **`web/public/data/` non versionné** tant que GroupLens n'a pas répondu — données dérivées de MovieLens — `projet` §10.
- ✗ **Dataset Letterboxd 10M** : non utilisé — collecte probablement par scraping, pas de vérité terrain — `é3` D6.
- ✗ **Scraping Letterboxd** : hors MVP, option secondaire au mieux — contraire aux conditions, fragile — `projet` §4.

## Modèle

- **ALS (`implicit`) en production**, configuration A : 64 facteurs, `regularization` 0,05, `alpha` 1, β 1, 30 itérations — bon compromis qualité / taille / calcul dans le navigateur — `é2` C2, D6.
- Signal : tout film vu est positif, pondéré par le percentile de sa note (`r = 1 + β·p`, 0,5 sans note) — un 3★ n'a pas le même sens pour tous — `é2` D2.
- **Fold-in de l'utilisateur du site sans les films mal notés** : films notés de percentile < 0,3 retirés du fold-in (toujours « vus », jamais recommandés), films sans note jamais retirés, ex æquo retirés ou gardés en bloc, repli si moins de 5 films ; l'entraînement ne change pas — +8,2 % de NDCG@20 à ∞ sur la validation, moins de recos tirées par un film détesté — `é6c` D2.
- ✗ **« Tout film vu est un positif » pour le fold-in du site** (règle de `é2` D2) : un film détesté attirait des recos qui lui ressemblent ; remplacée par la ligne précédente (la règle reste vraie pour l'entraînement) — `é6c` D2, §2.2.
- **Calibration par genres** (Steck 2018, variante « part de films ») : 48 films choisis dans un vivier de 150 par cran ; **λ = 0,1 de ∞ à 10 000, 0,9 de 5 000 à 200**, table dans `model-meta.json` — la règle « au plus −3 % de NDCG@20 » s'applique à ∞, où la métrique mesure bien ce qu'on veut ; aux crans bas, NDCG@20 ≈ 0,008 ne voit presque plus rien et la dérive de genre observée (94-100 % d'animation pour 13 % de l'historique) domine. La vraie mesure aux crans bas sera la question des volontaires (étape 7) — `é6c` D1, Q3.
- ✗ **Pénalité de proximité aux films mal notés** avant la calibration (Q4b, **option a** le 12 novembre 2026 : pas au MVP ; la forme mesurée reste la référence, code non branché, μ à réévaluer avec les volontaires — à λ = 0,9 elle agit peu, μ ≥ 1 fait remonter l'animation et coûte 14-16 % de NDCG@20 aux crans bas, et sur la validation D2 + D1 est déjà sous le hasard, 6,7 et 7,4 /16) ; forme mesurée : `score / s_max − μ × max(0, cos max)`, μ en unités du meilleur score du vivier ; décision d'origine : `score' = score − μ × max(cosinus avec les films mal notés)` aux crans à λ = 0,9 ; μ à choisir sur la validation (−3 % à ∞) et sur deux exports — « mal noté » = 30 % de l'historique par construction (percentile < 0,3), donc au hasard environ la moitié des recos (≈ 8/16) ont un film mal noté parmi leurs 2 plus proches voisins ; D2 seul est sous le hasard, la calibration y ramène ; un filtre dur retirerait la moitié du vivier — `é6c` D1b.
- ✗ **Filtre dur des films proches d'un film mal noté** : retirerait la moitié du vivier — `é6c` D1b.
- ✗ **Calibration « masse »** (Steck d'origine, 1/k par genre) : un film d'animation à 4 genres ne pèse que 1/4 ; même à λ = 0,99, 38 % d'animation aux crans bas — `é6c` Q3.
- ✗ **λ unique sous la règle des −3 % à ∞** (masse 0,4 ou part 0,1) : 69-94 % d'animation restaient aux crans bas — `é6c` Q3.
- Autres versions d'un film (`version_of` dans `manual_overrides.csv`, dans les deux sens) : jamais recommandées si l'une est vue ; 2 cas dans le catalogue, liste manuelle (une règle automatique ferait surtout des faux positifs) — `é6c` D3.
- **Test de l'étape 6c, évalué une seule fois** (12 novembre 2026, `calibration.py test`) sur D2 + D1 : NDCG@20 à ∞ 0,1601 (étape 2 : 0,1521 ; D2 seul : 0,1646) ; crans 2 000 / 500 : 0,0190 / 0,0053 (−28 % par rapport à D2), écart de calibration −84 à −87 % — cohérent avec la validation — `é6c` Q5.
- Protocole : 10 000 utilisateurs de validation et 10 000 de test, 80 % des notes les plus anciennes en fold-in, 20 % à retrouver ; test évalué une seule fois — pas de fuite, pas de sur-ajustement — `é2` D1, D3.
- Modèle final réentraîné sur **tous les utilisateurs** — plus de signal pour le site — `é2` D6, C5.
- **Vecteurs int8** (échelle par film), `YᵀY` calculé sur les vecteurs déquantifiés — 1,57 Mo, perte < 0,08 % — `é2` D8, C5.
- `item_idx` figé à l'entraînement ; l'export relit l'ordre sauvegardé — éviter un décalage silencieux entre vecteurs et catalogue — `CLAUDE.md`.
- ✗ **EASE en production** : meilleur (+11 %), mais sa matrice film × film (23 019², ~2 Go en float32) est impossible à embarquer ; il reste un point de comparaison hors ligne — `é2` D7, C3.
- ✗ **Configuration B** (alpha 10) : moins bonne que A à ∞ et au-dessus de ~5 000 notes, là où la plupart des utilisateurs commencent — `é2` D5.
- ✗ 128 facteurs : il fallait ≥ 3 % de gain pour doubler la taille — `é2` D6.
- Seuil ≥ 10 notes (catalogue plus grand) : optionnel, **pas fait** — `é2` D9.

## Films récents (étape 8)

- **Films TMDB absents de MovieLens, sortis depuis 2022, placés dans l'espace ALS hors ligne** (≥ 50 votes : comptent dans le profil ; ≥ 500 : recommandables, 563 films) — MovieLens 32M s'arrête le 12/10/2023 et le trou commence avant (films 2022-2023 sous 20 notes) — `é8` D0, R0.
- **Vecteur = contenu TMDB seul** (ridge des vecteurs ALS centrés sur réalisateurs, acteurs, genres, mots-clés, langue, pays, décennie, votes, note) — seul ingrédient qui bat la popularité au faux départ à froid (Recall@20 base 0,129 contre 0,037) — `é8` D2, R3.
- ✗ **Voisins TMDB `recommendations`** (moyenne pondérée, placement chronologique) et **mélange voisins / contenu** : pas mieux que la popularité (+0,007 ± 0,020), le mélange dégrade le contenu — `é8` D1, D3, R3.
- ✗ **`similar` TMDB** : pire que le hasard une fois centré — `é8` 2.3.
- **Norme du vecteur estimé = norme médiane des films du catalogue de la même tranche de popularité du curseur** — sans recalage, les films estimés sont invisibles ou envahissants — `é8` D1c.
- ✗ **Norme par tranche de votes TMDB** : 40-55 % des top 20 aux crans 2 000 et 500 pour 2 % du catalogue — `é8` D1c, R3.
- **Facteur 0,8 sur la norme cible des films estimés** — rétrécissement d'une estimation incertaine : les vecteurs prédits par le contenu pointent vers la direction moyenne ; à norme pleine (avec la nouvelle popularité), ils prenaient 5,3 % des top 20 à ∞ et NDCG@20 tombait à 95 % ; à 0,8 : 97,7 %, 2,7 % des top 20 ; réglé sur la validation, vérifié une fois sur le test à la clôture — `é8` D1c, R3d.
- **ω = 1** (films estimés comptés comme les autres dans le fold-in) ; **`YᵀY` limité aux films entraînés** — aucune différence mesurable pour ω ; `YᵀY` avec les estimés moins bon — `é8` D6, R3.
- **Popularité à partir de 2019 (catalogue et films estimés) : rang absolu des votes TMDB dans l'année** : le r-ième film le plus voté reçoit la médiane, sur 2010-2018, de la r-ième plus haute popularité de l'année ; jamais moins qu'avant — MovieLens sous-compte même les succès à partir de 2019 (10ᵉ film le plus voté de 2019 : 5 158, sous toutes les années 2010-2018) ; contrôles : aucun des 10 films les plus votés de chaque année sous 10 000, pas de saut en 2019 — `é8` D7, R3d.
- ✗ **`year_all` à partir de 2019** (gardé avant) : il laissait les succès de 2019-2023 entre 1 600 et 10 000 (10ᵉ film le plus voté de 2023 : 1 603), donc pris pour des pépites aux crans 2 000 à 10 000 — `é8` R3d.
- ✗ **Centile des votes dans l'année, référence 2019-2022** (popularité des films estimés v0.2-v0.3) : aucun gros succès récent au-dessus de 10 000, 52 % des films recommandables sous le cran 500 ; la référence 2019-2022 hérite du sous-comptage de MovieLens — `é8` R3c.
- **ρ = 0** (pas de pénalité de qualité TMDB) : à ρ = 0,05 et 0,1, aucun film vu et mal noté retiré du top 20 ; la note TMDB est affichée sur la carte — `é8` D4, R3b.
- ✗ **« ≥ 70 % du vrai vecteur »** comme seuil : dégénéré (vrai vecteur des films 2022-2023 presque jamais recommandé) ; remplacé par la vraie direction avec norme recalée — `é8` D5.

## Curseur et popularité

- **Curseur V3 = plafond de popularité** : à chaque cran, seuls les films sous le plafond, classés par le score du modèle — même effet pour tous, listes homogènes, explicable (« moins de 2 000 notes ») — `é2` D5.
- **8 crans** : ∞ → 20 000 → 10 000 → 5 000 → 2 000 → 1 000 → 500 → 200 ; ∞ = ordre du modèle — `é2` C4.
- ✗ **V1** (`score − λ × log(popularité)`, prévu au départ) : effet nul puis brutal, moitié basse identique pour tous — `é2` D5.
- ✗ **V2** (reclassement du top K) : plancher fixé par K, listes mixtes, régularité 3 à 10 fois moins bonne — `é2` D5.
- ✗ Transition douce près du plafond : pas au MVP — simplicité — `é2` D5.
- **Popularité hybride** : `max(arrondi(ml × f_année), arrondi(0,285 × tmdb_vote_count))` — MovieLens s'arrête en 2023 et sous-compte les films récents — `é2` D5, `é4` §6. À partir de 2019 : rang des votes dans l'année (étape 8, voir « Films récents »).
- Correction **`year_all`** (`f_année = max(1, 0,285 / r_année)` pour toutes les années) — le rapport MovieLens/TMDB baisse en continu depuis 2000 ; elle ne rend jamais un film plus confidentiel qu'avant — `é4` §6.
- ✗ `year_2019` et `tmdb_recent` (autres corrections) : corrigent moins bien les films récents — `é4` §6.
- ✗ **Popularité TMDB seule** : fait passer des films de fans et des curiosités pour des pépites — `é2` C4, C5.
- ✗ Comparer des NDCG d'un cran à l'autre : le held-out MovieLens est surtout populaire, donc biaisé contre les pépites — `é2` D5.
- Films sortis après 2023 : **trou accepté au MVP**, signalé dans l'interface — MovieLens 32M s'arrête là — `projet` §9.

## Import et correspondance des titres

- **Architecture d'adaptateurs** (un par source) vers un format commun ; notes en **percentiles par utilisateur** — ajouter des sources sans toucher au reste — `projet` §4, `é3` D4.
- Letterboxd : `ratings.csv`, `watched.csv`, `diary.csv` seulement ; journal rattaché par (titre, année) ; **`profile.csv` jamais lu** — rien de personnel au-delà des films — `é3` D4.
- **Normalisation « v2 » identique en Python et en TypeScript**, vérifiée par des cas partagés (`shared/fixtures/`) et sur 100 % des titres du catalogue — une seule vérité — `é3` D1.
- Index de titres précalculé (titre TMDB, titre MovieLens nettoyé, titre original, titre alternatif) ; titre + année ±1, puis variantes — `é3` D3, D5.
- **Le flou (Fuse.js) n'est jamais utilisé automatiquement** : il rattachait des séries à des films ; il ne sert qu'à proposer des candidats — `é3` D5, `é4` D4.
- Exclus des recommandations : films vus, non recommandables, candidats `ambiguous` et candidat principal `probable_fuzzy` — recommander un film déjà vu coûte plus cher que d'en masquer un — `é4` D4.
- Un candidat choisi par l'utilisateur devient **`confirmed`** et entre dans le fold-in ; rien n'est coché par défaut — l'utilisateur garde la main — `é5` D4.
- ✗ IA pour les listes faites main au MVP — coût, clé à cacher ; Fuse.js suffit pour commencer — `projet` §9.

## Import IMDb

- **CSV des notes IMDb** lu dans le navigateur ; colonnes lues par nom (`Const`, `Your Rating`, `Date Rated`, `Title`, `Original Title`, `Title Type`, `Year`), tout le reste ignoré ; notes 1-10, percentiles communs — même format interne que Letterboxd — `é6` D1.
- **Source détectée par l'en-tête**, jamais par le nom du fichier ; UTF-8 strict puis Windows-1252 — IMDb et Letterboxd appellent tous deux leur fichier `ratings.csv`, le vrai export IMDb s'appelle `<uuid>.csv` — `é6` D5, §2.
- **Liste ou watchlist IMDb** (colonne `Position`) : message, pas d'import ; watchlist hors MVP — il faut des films vus et notés ; la watchlist réelle a une colonne `Your Rating` vide — `é6` D6, §2.
- **Rapprochement par `imdb_id`** puis `imdb_id_aliases` (partie numérique de l'id) → `exact` — tous les films du catalogue ont un id distinct — `é6` D2.
- **Repli par titre** (`Title` puis `Original Title`, matcher de l'étape 3) **toujours envoyé dans « à vérifier »**, jamais dans le fold-in sans choix de l'utilisateur — un titre trouvé sans l'id est le plus souvent un homonyme — `é6` D3 (v0.2).
- **`Title Type` est traduit** dans la langue du compte (`Film`, `Série télévisée`, `Épisode télévisé`) : seuls les types **connus comme non-films** (anglais, français ; « Mini-série télévisée » et « Jeu vidéo » probables, non vérifiés) sont sans repli et comptés à part ; tout type inconnu est un film — sans risque puisque le repli va dans « à vérifier » — `é6` D3-D4 (v0.3), G0.
- ✗ **Liste des types film** (v0.2) : avec un compte en français, `Film` était classé non-film, et aucun film non trouvé par id n'avait de repli — `é6` G0.
- Export d'exemple IMDb **synthétique**, types en français (cas le plus probable pour notre public), pas de second lien « exemple » à l'accueil — `é6` D8.
- Mesure des taux sur un vrai historique IMDb **reportée à l'étape 7** — l'export de Thibault (compte créé pour l'occasion) est trop petit et fabriqué — `é6` G4.

## Calcul dans le navigateur

- **Un seul moteur** (`web/src/reco/engine.ts`) pour le Web Worker et les scripts du terminal ; il rejoue `foldin_cases.json` à l'identique — pas de divergence entre ce qu'on mesure et ce qu'on montre — `é4` D5.
- Fold-in par Cholesky 64 × 64 en float64 — reproduit `implicit` à 10⁻¹⁵ près — `é4` D2.
- Un seul `recommend({ n: 48 })` après l'analyse, pour les 8 crans — le curseur n'est plus qu'un affichage (≤ 50 ms) — `é5` D5.
- Cache HTTP au MVP ; IndexedDB reporté (étape 7 au plus tôt) — rien de stocké chez l'utilisateur — `é4` D1.

## Interface

- Direction visuelle **« C · Fanzine »** (papier, encre, stylo bleu comme seul accent, Courier Prime + Caveat) — ton cinéphile, artisanal — `DS`, `projet` §3.
- **Polices auto-hébergées** (`@fontsource`) — aucune requête vers Google — `é5` D1.
- Machine à états (accueil → analyse → résultats), pas de routeur — 3-4 écrans, rien à mémoriser — `é5` D2.
- Écran d'analyse : « à vérifier », « trop récents » (≥ 2024), « pas dans notre catalogue » — dire honnêtement ce qu'on a compris du fichier — `é5` D4.
- Résultats : départ au cran 2 000, 8 cartes puis « encore des films » 8 par 8 (48 au plus) ; phrase du titre selon le cran — `é5` D5.
- Profil « (t'aimes bien X, Y et Z, non ?) » : réalisateurs aimés (≥ 2 films chacun), noms complets — couper au nom de famille se tromperait sur les noms asiatiques — `é5` D5, G4.
- Indicateur « loin de tes goûts » si le score relatif est **< 0,04** (0,10 écarté : il s'affichait pour tout le monde dès 1 000 notes) — à recaler avec les volontaires — `é5` D5.
- **Tags des cartes** (étape 6c, Q6) : un seul par carte, même emplacement et même forme que le tampon, **une couleur par tag** (pépite bleu stylo, réalisateur vert, ça divise rose foncé, vieux trésor pastille jaune ; AA dans les deux thèmes, jamais d'orange ; décidé à l'essai à l'écran) ; hiérarchie ✱ pépite > « encore un <réalisateur> » (phrase de profil) > « ça divise » (écart-type rétréci de 50 notes fictives, 10 % les plus dispersés : l'écart-type brut mettait le tag sur les films à 20-50 notes) > « vieux trésor » (avant 1960 et popularité ≤ 1 000 : avant 1970, 26-30 cartes sur 48 aux crans bas d'un profil classique) ; 2 au plus par rangée de 8 ; le tag s'ajoute aux annotations — lisible, explicable — `é6c` Q6.
- Tampon **« ✱ pépite »** : au plus un par rangée de 8, sur le moins connu s'il a au plus la moitié de la popularité médiane de la rangée — signale le film qui détonne dans ce qu'on voit — `é5` D6, G6.
- ✗ Tampon à popularité ≤ 1 000 (v0.1), puis ≤ 1 000 avec plafond > 1 000 (v0.2) : soit partout aux crans bas, soit presque jamais — `é5` D6, G6.
- ✗ **Mention « spectacle »** (stand-up) par une règle sur les titres : 61 % de précision, reportée aux genres TMDB — `é5` G4, G6.
- Documentaires : mention sur la carte + case « sans les documentaires » (filtre local) — `é5` D6.
- Carte = lien vers `https://letterboxd.com/tmdb/<tmdb_id>/` (redirection vérifiée) ; fiche film reportée à l'étape 8 — `é5` D6.
- Export d'exemple **synthétique** (films connus, notes inventées) — démontrer le site sans donnée personnelle — `é5` D3.
- Accessibilité : vrais `<button>`, `<a>`, `<label>` ; contraste AA ; zones tactiles ≥ 44 px ; 0 violation axe grave — `CLAUDE.md`, `é5` G5.
- **Thème sombre par défaut**, même si le système est en clair ; bouton « passer en clair » ; palette sombre (stylo bleu éclairci `#8EA6FF`, cartes un cran plus claires que le fond, scotch gardé, jamais d'orange), AA dans les deux thèmes — `é6b` D7, Q1-Q2.
- Pages « comment ça marche », « à propos », « contact » ouvertes par l'ancre par-dessus l'écran courant (gardé, cran compris), navigation sur tous les écrans — garder la machine à états, permettre les liens directs — `é6b` D2.
- « À propos » à la première personne, sans nom d'école ; le reste du site garde le « on » ; textes de Claude Web dans `web/src/content/` — `é6b` D1, D8.
- Contact : adresse en texte + « copier », formulaire qui ouvre un `mailto:` pré-rempli ; aucun service tiers — rien de nouveau sur le réseau — `é6b` D3.
- Aide des exports : carrousel à onglets, schémas SVG au trait, aucune capture ni logo de marque — `é6b` D4.
- Note du public sur les cartes : moyenne MovieLens sur 5 + nombre de notes (`catalog.json` v2, +55 Ko gzip) — `é6b` D5.
- **« (parce que t'as aimé X et Y) »** (explications avancées de l'étape 8) : cosinus des vecteurs, films notés de percentile ≥ 0,7, repli « vu » sans aucune note ; pas sur une carte de série ; **2 cartes au plus par film cité et par rangée de 8** — sinon un même film était cité sur 7-8 cartes sur 8 — `é6b` D6, R6.
- R9 : tampon « ✱ pépite » en haut à droite de l'affiche ; 20 voisins candidats pour les explications (le plafond de diversité n'en laisse plus aucune vide) ; aide des exports ouverte par défaut sous la zone de dépôt ; conteneur unique de 1 200 px aligné à gauche, paragraphes à ~65 caractères ; liens externes dans les textes (`{a:…}`, nouvel onglet) — `é6b` R9.
- **« Loin de tes goûts » par rangée** (Q4 révisée) : score relatif par carte ; si au moins la moitié d'une rangée de 8 est sous 0,04, une seule annotation au-dessus de la grille, « (à ce cran, on s'éloigne un peu de tes goûts : c'est le prix des vraies pépites) », et les explications restent ; sinon, règle de l'étape 5 (cran < 0,04 : note sous le curseur, explications masquées) — masquer les explications vidait tout le cran 200 d'un vrai export — `é6b` D6, R10.
- Changement de cran : 50 ms **sur la médiane** de 21 mesures, pire cas journalisé seulement — les pointes viennent du rendu des affiches sur une machine chargée — `é6b` R6.

## Confidentialité

- **Aucun appel réseau avec les films ou les notes de l'utilisateur** ; seules requêtes hors du site : les affiches TMDB (vérifié par Playwright) — principe fondateur — `CLAUDE.md`, `é5` G5.
- Rien de stocké dans le navigateur (ni IndexedDB, ni cookie, ni `sessionStorage`) — « on garde rien » — `é5` D2, G5. **Seule exception** : la clé `localStorage` `pepite-theme` = `light` quand l'utilisateur choisit le thème clair, supprimée au retour au sombre ; dite dans « on garde rien » ; vérifiée par Playwright — `é6b` D7.
- Clé TMDB uniquement dans `.env` (ignoré) et les secrets GitHub, jamais affichée — `CLAUDE.md`.
- Exports réels dans `web/test-data/` (ignoré) ; volontaires : taux seulement, fichiers supprimés après la mesure ; jamais de pseudo ni de titre d'un export dans le dépôt — `CLAUDE.md`, `é3` D6.
- ✗ **Fixture du fold-in versionnée** (`foldin_cases.json`) : elle contenait des notes MovieLens brutes ; elle est générée hors du dépôt et l'historique a été purgé le 7 novembre 2026 — `é2` C5, `CLAUDE.md`.
- Captures d'écran faites avec un export réel : jamais versionnées — `é5` G6.

## Méthode

- Une spec par étape (décisions, sous-étapes, critères, résultats, à reporter), validée avant de coder — `docs/etape-*.md`.
- Claude Code avance seul et s'arrête aux points de décision ; Claude Web intervient aux arrêts — `CLAUDE.md` (« Quand s'arrêter »), `contexte/etat-du-projet.md`.
- Commits petits et poussés à chaque sous-étape ; tout est poussé avant un arrêt — `CLAUDE.md`.
- À chaque clôture d'étape : `CLAUDE.md`, `stack-technique.md` et `contexte/` mis à jour dans le même commit — `CLAUDE.md`.
- Python 3.12 + uv + Polars + ruff ; TypeScript strict + ESLint + Prettier + Vitest + Playwright — `CLAUDE.md`.
