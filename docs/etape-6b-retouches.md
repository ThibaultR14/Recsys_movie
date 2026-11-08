# Étape 6b — Retouches de l'interface

> Version 0.3 (8 novembre 2026) : sous-étape R9 ajoutée après l'essai de Thibault. Version 0.2 : Mini-étape insérée entre l'étape 6 (adaptateur IMDb) et l'étape 7 (mise en ligne). **Validée par Thibault le 8 novembre 2026**, avec ses réponses aux questions de la section 7 (v0.2) : cartes sombres un cran plus claires que le fond, scotch gardé (D7) ; sombre par défaut même si le système est en clair (D7) ; l'annotation de série remplace l'explication, pas d'explication sur les cartes « loin de tes goûts », repli « parce que t'as vu » pour un historique sans notes (D6) ; « qui on est » → « à propos », pied de page inchangé (D1, D2) ; adresse de contact décidée en R8 (D3).
> Décisions de départ données par Thibault le 8 novembre 2026 (D1-D7). Les **textes de l'interface** viennent de Claude Web : le code prévoit des emplacements (D8), remplis en R7.

---

## 0. Mode d'emploi (pour Claude Code)

- Relis ce document au début de chaque sous-étape. Les décisions de la section 3 ne changent pas sans accord.
- Une sous-étape à la fois (R0 → R9), en suivant « Quand s'arrêter » de `CLAUDE.md`. **Arrêts obligatoires** :
  - en **R7**, pour recevoir les textes de Claude Web (Thibault peut les donner plus tôt : ils sont intégrés dès qu'ils arrivent, R7 ne fait alors que vérifier qu'il n'en manque aucun) ;
  - en **R8**, si l'adresse de contact n'est pas confirmée (D3) ;
  - en **R8**, pour l'essai sur un vrai téléphone (deux thèmes) et la relecture.
- Résultats dans la section 5 : chiffres exacts.
- **Données personnelles** (inchangé) : l'export de Thibault reste dans `web/test-data/exports/` ; les explications calculées sur son export (D6) ne s'affichent que dans le terminal (`reco-report`) ; dans les fichiers versionnés, comptes et temps seulement, aucun titre.

---

## 1. Objectifs

1. Séparer « comment ça marche », « à propos » et une nouvelle page « contact », accessibles depuis l'en-tête et par un lien direct, sans quitter la machine à états.
2. Rendre l'aide « où trouver mon export » visuelle : un carrousel accessible avec des schémas dessinés.
3. Enrichir les cartes : note du public (MovieLens) et « parce que t'as aimé X et Y ».
4. Thème sombre par défaut, thème clair au choix, contraste AA partout.
5. Ne rien changer à la confidentialité : **aucune requête réseau nouvelle**, une seule clé stockée (le choix du thème clair).

---

## 2. Données d'entrée

- **Interface actuelle** (fin d'étape 6) :
  - `App.tsx` : machine à états `accueil` → `analyse` → `resultats` ; la page « à propos » s'affiche déjà **par-dessus l'écran courant** quand l'ancre vaut `#a-propos` ou `#comment-ca-marche` (l'écran est gardé : revenir à `#` retrouve les résultats sans recalcul) ;
  - `Layout.tsx` : en-tête avec le logo et la navigation (« comment ça marche », « qui on est ») **seulement à l'accueil** ; en analyse et en résultats, la navigation est remplacée par « ← changer de fichier » ;
  - `APropos.tsx` : une seule page, sections `#a-propos`, `#comment-ca-marche`, `#on-garde-rien`, `#limites`, `#donnees` (mentions TMDB et MovieLens) ; texte à la première personne du pluriel, avec le nom de l'école ;
  - `Accueil.tsx` : bouton « je sais pas où trouver mon export » qui déplie deux paragraphes (Letterboxd, IMDb) ;
  - `FilmCard.tsx` : affiche, titre, « réalisateur, année », « documentaire », annotation « (même série que « X », que t'as vu) » (Caveat), tampon « ✱ pépite » ;
  - couleurs : jetons Tailwind dans `web/src/styles/index.css` (`paper`, `white`, `ink`, `muted`, `rule`, `pen`, `tape`), un seul thème clair.
- **Catalogue** (`catalog.parquet`) : `ml_mean_rating` (moyenne MovieLens sur 5, de 0,86 à 4,40) et `ml_rating_count` (de 20 à 102 929) existent déjà ; `catalog.json` ne les contient pas.
- **Taille mesurée le 8 novembre 2026** (même sérialisation que `site_catalog.py`, gzip niveau 9) : `catalog.json` **1 117 254 → 1 172 373 octets gzip (+55 Ko, +4,9 %)** en ajoutant deux tableaux d'entiers (`ml_mean` = moyenne × 10, `ml_count`). Total `web/public/data/` : ~3,06 → ~3,11 Mo gzip.
- **Moteur** : les vecteurs d'items (int8, une échelle par film) et l'historique (percentiles) sont déjà dans le worker ; `recommend({ n: 48 })` calcule les 8 crans en une fois (19 ms pour l'export de Thibault, 42 ms pour 3 000 films, étape 4).

---

## 3. Décisions

### D1. « À propos » à la première personne

- La page « à propos » passe au **« je »** (« je suis étudiant… »), **sans nom d'école** ni de formation précise. Le reste du site garde le « on » (accueil, analyse, résultats, comment ça marche, contact).
- Elle garde les **mentions obligatoires** (`CLAUDE.md`) : logo TMDB + « This product uses the TMDB API but is not endorsed or certified by TMDB. », citation MovieLens (Harper & Konstan, 2015), phrase « ni soutenu ni approuvé par l'université du minnesota, grouplens ou tmdb ». Ces textes ne viennent pas de Claude Web : ils restent tels quels.
- Textes : emplacements `apropos.*` (D8).
- Le pied de page (« fait à la main par des gens qui regardent trop de films ») **n'est pas touché** (Q5).

### D2. Trois pages par ancre, par-dessus la machine à états

- Pages : **« comment ça marche »** (détaillée), **« à propos »**, **« contact »**. La machine à états de l'étape 5 (D2) est gardée : la page affichée se déduit de l'**ancre**, pas de l'état. C'est le mécanisme actuel, étendu (simple, pas de routeur) :
  - `#comment-ca-marche`, `#a-propos`, `#contact` ouvrent la page correspondante ;
  - les ancres de sections ouvrent leur page puis défilent jusqu'à la section (table `PAGE_OF_HASH` dans `web/src/pages/pages.ts`) : `#on-garde-rien`, `#modele`, `#curseur`, `#donnees`, `#limites`, `#inspirations` → « comment ça marche » ; `#mentions` → « à propos » ;
  - **lien direct** : l'ancre est lue au chargement, donc `…/#contact` ouvre la page contact (l'écran dessous est l'accueil, rien n'étant stocké) ; précédent / suivant du navigateur fonctionnent (`hashchange`) ;
  - fermer une page : lien « ← retour » vers `#` (l'écran courant réapparaît, résultats et cran du curseur compris, sans recalcul).
- **« comment ça marche »** : sections dans cet ordre, textes de Claude Web : le modèle (des goûts comparés, **pas de genres**), les percentiles (pourquoi un 3★ n'a pas le même sens pour tous), le curseur (plafond de popularité, 8 crans), les données (MovieLens, TMDB, d'où vient la note du public), on garde rien (D7), ce qu'on sait pas faire (films après 2023, séries, films très peu vus), inspirations. Une phrase sur l'explication des cartes (D6) dans la section du modèle.
- **Navigation dans l'en-tête, sur tous les écrans** : logo, puis « comment ça marche », « à propos » (ex-« qui on est », Q5), « contact », puis le bouton de thème (D7). Le lien de la page ouverte porte `aria-current="page"`.
  - « ← changer de fichier » quitte l'en-tête et passe en haut du contenu (analyse et résultats).
  - Téléphone : la navigation passe sur une deuxième ligne sous le logo ; zones tactiles ≥ 44 px, pas de menu repliable (trois liens tiennent sur 360 px en deux lignes au plus).
- Fichiers : `web/src/pages/CommentCaMarche.tsx`, `APropos.tsx` (réduit), `Contact.tsx`, `pages.ts` (ancres), `Layout.tsx`, `App.tsx`.

### D3. Contact

- **Adresse** : `[ADRESSE À CONFIRMER]`, dans une seule constante (`CONTACT_EMAIL`, `web/src/content/contact.ts`). Affichée **en texte sélectionnable** (pas une image, pas d'obfuscation) + bouton **« copier »** :
  - `navigator.clipboard.writeText` ; si l'API échoue (contexte non sécurisé, refus), le texte de l'adresse est sélectionné et le message invite à faire ctrl+c ;
  - résultat annoncé dans une zone `aria-live="polite"` (« copié »).
- **Formulaire** : vrai `<form>` avec `<fieldset>` + `<legend>` pour le sujet (boutons radio : bug, film mal reconnu, idée, autre ; aucun coché par défaut, choix obligatoire) et `<label>` + `<textarea>` pour le message (obligatoire, 2 000 caractères au plus, compteur visible). Le bouton **ouvre un `mailto:` pré-rempli** :
  - sujet : `[pépite] <sujet>` ; corps : le message, rien d'autre ;
  - construit par une fonction pure `mailtoHref(subject, message)` (`encodeURIComponent`, retours à la ligne en `%0D%0A`), testée par Vitest ;
  - **rien n'est ajouté automatiquement** : ni navigateur, ni films de l'utilisateur, ni résultats d'analyse. Pour « film mal reconnu », l'aide du champ suggère d'écrire le titre, l'année et la source (texte de Claude Web).
  - Sous le bouton, une phrase : si aucune application de mail ne s'ouvre, copier l'adresse.
- **Aucun service tiers, aucune requête nouvelle** : pas de Formspree, pas de captcha, pas de `fetch`. Le formulaire n'est jamais envoyé à un serveur (`onSubmit` empêche l'envoi et navigue vers le `mailto:`).
- Risque accepté : une adresse en clair attire du spam. **Adresse décidée par Thibault en R8** (adresse dédiée probable) ; d'ici là, l'emplacement `[ADRESSE À CONFIRMER]` reste (Q6).

### D4. Aide des exports : carrousel accessible

- Remplace les deux paragraphes dépliés par « je sais pas où trouver mon export » (le bouton dépliant reste).
- **Onglets** « letterboxd » / « imdb » : motif ARIA *tabs* (`role="tablist"`, `tab`, `tabpanel`, `aria-selected`, tabindex itinérant, flèches ← →, Début / Fin). Letterboxd sélectionné au départ.
- **Étapes** dans chaque onglet : 3 pour Letterboxd, 4 pour IMDb (base : les textes actuels de l'accueil) :
  - Letterboxd : réglages → « import & export » → « exporter tes données » → le .zip à glisser tel quel ;
  - IMDb : profil → évaluations → « … » / actions → exporter → page des exports (attendre, recharger) → télécharger le .csv et le glisser ;
  - les noms de menus sont **vérifiés par Thibault sur les vrais sites** (R7) ; sur téléphone, préciser si l'export se fait sur le site et non dans l'application (texte de Claude Web).
- **Navigation** : boutons « ← précédent » / « suivant → » (vrais `<button>`, désactivés aux extrémités), indication « étape 2 sur 4 », changement annoncé par `aria-live="polite"`. **Pas de défilement automatique.** Pas d'animation si `prefers-reduced-motion` ; sinon un fondu court (≤ 150 ms) au plus.
- **Illustrations** : une par étape, **SVG en ligne dessiné à la main dans le style fanzine** : blocs d'interface schématiques (rectangles encre, pointillés, lignes de texte simulées par des traits), la cible entourée ou fléchée au **stylo bleu** (Caveat pour l'annotation), libellés en Courier Prime.
  - **Pas de capture d'écran, pas de vidéo, aucun logo ni couleur de marque** (ni le vert / orange / bleu de Letterboxd, ni le jaune d'IMDb), pas de reproduction fidèle des pages : un schéma « de mémoire ».
  - Couleurs par `currentColor` et variables CSS : le même SVG marche dans les deux thèmes.
  - Le texte de l'étape porte l'information ; le SVG est `aria-hidden="true"`.
  - Budget : ≤ 3 Ko par SVG, ≤ 25 Ko pour les 7 (non compressés).
- Fichiers : `web/src/components/ExportHelp.tsx`, `web/src/components/help/*.tsx` (un SVG par étape).

### D5. Note du public sur les cartes

- **Pipeline** (`site_catalog.py`) : deux tableaux ajoutés à `catalog.json`, version `v: 2` :
  - `ml_mean` : moyenne MovieLens × 10, entier (arrondi au plus proche, 0,5 vers le haut : `floor(x × 10 + 0,5)`) ;
  - `ml_count` : `ml_rating_count` (nombre de notes MovieLens).
  - Ce sont des agrégats, pas des notes brutes (règle « aucune note MovieLens brute dans le dépôt » respectée) ; `web/public/data/` reste non versionné (attente GroupLens). Rien des datasets IMDb.
  - Pas de réentraînement : l'ordre `item_idx` ne bouge pas. `export.py catalog --out web` puis `catalog-verify` (vérifie les deux tableaux).
- **Carte** : sous « réalisateur, année », en encre pâle 13 px : **« ★ 3,9 · 1 240 notes »** (virgule décimale, séparateur des milliers `Intl.NumberFormat('fr-FR')`, espace insécable fine).
  - Le « ★ » est `aria-hidden` ; lecteur d'écran : « note moyenne 3,9 sur 5, 1 240 notes ».
  - **Cohérence avec le curseur** : la popularité du curseur est ≥ `ml_count` (formule hybride), donc le nombre affiché ne dépasse jamais le plafond du cran.
  - « notes » = notes MovieLens ; c'est expliqué dans « comment ça marche » (données). Pas de note IMDb ni TMDB.
- Critère de taille : `catalog.json` ≤ +60 Ko gzip (mesuré : +55 Ko).

### D6. « (parce que t'as aimé X et Y) »

C'est la fonction **« explications »** de l'étape 8, avancée (feuille de route mise à jour à la clôture).

- **Films cités** : parmi l'historique du fold-in (`exact`, `probable_variant`, `confirmed`) **avec une note** et un percentile **≥ 0,7** (seuil réglable, `LIKED_PERCENTILE`), les **2** dont le vecteur d'item est le plus proche du film recommandé (cosinus).
  - Vecteurs int8 : l'échelle par film se simplifie dans le cosinus ; on précalcule une fois les normes des vecteurs des films aimés.
  - Un seul film aimé proche → « (parce que t'as aimé X) » ; aucun → pas d'annotation.
  - **Historique sans notes** (aucune entrée notée : tout à 0,5, par ex. `watched.csv` seul) : **repli sur tous les films vus**, annotation « (parce que t'as vu X et Y) » (texte final de Claude Web, `cartes.parceQueVu1`, `cartes.parceQueVu2`). Un historique avec au moins une note mais aucune ≥ 0,7 n'a pas de repli : pas d'annotation (v0.2).
  - Un film n'est cité que si le cosinus est **> 0** (seuil `MIN_COSINE`, réglable en R6).
  - Titre cité = titre affiché du catalogue (pas celui de l'export).
- **Calcul** : une seule fois, dans le worker, **juste après `recommend({ n: 48 })`**, pour tous les films distincts des 8 crans (≤ 384). Fonction pure `explain()` dans `web/src/reco/explain.ts`, appelée par `workerCore.ts` et par `reco-report` (affichage dans le terminal). Le changement de cran n'ajoute **aucun** calcul.
- **Temps** : ≤ +100 ms sur `recommend` pour 3 000 films (`reco-bench`), changement de cran toujours **≤ 50 ms** (Playwright). Estimation : 384 × ~900 films aimés × 64 ≈ 22 M multiplications, soit quelques dizaines de ms.
- **Affichage** : annotation Caveat stylo bleu sous la ligne de note, comme l'annotation de série. Titres de plus de 32 caractères coupés avec « … » (titre complet dans le texte pour lecteur d'écran). **Pas de pourcentage de correspondance.**
- **Annotation de série** : elle **remplace** l'explication sur la carte (Q3).
- **Cartes « loin de tes goûts »** (score relatif < 0,04) : **pas d'explication** (Q4).
- **Mesure informative en R6** (terminal seulement, export de Thibault) : nombre de films distincts cités sur les 8 premières cartes de chaque cran, part des cartes sans explication. Si un même film est cité sur presque toutes les cartes, **arrêt** pour décider d'une règle de diversité (hors des décisions écrites).
- Alternative non retenue au MVP : l'explication exacte de l'ALS (contribution de chaque film de l'historique au score, via la matrice du fold-in), plus fidèle mais moins intuitive. Notée en §6.

### D7. Thème sombre par défaut, clair au choix

- **Sombre par défaut.** Bouton dans l'en-tête, vrai `<button>`, libellé visible « passer en clair » / « passer en sombre » (texte de Claude Web), petit dessin SVG au trait possible, **pas d'emoji**. Il pose `data-theme="dark" | "light"` sur `<html>`.
- **Palette sombre**, à ajouter au design system (§2, nouveau tableau) ; valeurs proposées, contrastes calculés le 8 novembre 2026 (WCAG, sur le fond / sur la surface) :

| Rôle | Clair (actuel) | Sombre (proposé) | Contraste sombre |
|---|---|---|---|
| Fond `paper` | `#FBFAF7` | `#16171B` | — |
| Surface `surface` (cartes, zone de dépôt ; remplace `white`) | `#FFFFFF` | `#23242A` | — |
| Texte `ink` | `#1B1B1B` | `#ECE8DF` | 14,7 / 12,7 |
| Texte secondaire `muted` | `#555049` | `#ADA79C` | 7,5 / 6,5 |
| Filet `rule` | `#B9B4AA` | `#5A574F` (décoratif) | 2,5 |
| Accent `pen` (stylo bleu éclairci) | `#2546B8` | `#8EA6FF` | 7,7 / 6,7 |
| Scotch `tape` | `rgba(214,208,196,0.75)` | `rgba(214,208,196,0.35)` | — |

  - **Jamais d'orange**, un seul accent (le stylo bleu), comme en clair.
  - **Cartes (Q1)** : sur la surface sombre, **un cran plus claire que le fond**, **scotch gardé** : on doit toujours lire une « photo ». L'ombre, invisible sur fond sombre, est remplacée par un filet 1 px `rule`.
  - `color-scheme: dark` pour les contrôles natifs (curseur, barres de défilement) ; `accent-color` = `pen`.
  - Le filet (`rule`) ne sert qu'aux séparations décoratives ; toute bordure de composant (zone de dépôt, boutons) utilise `ink` (≥ 3:1).
  - Logo TMDB : vérifier sa lisibilité sur fond sombre (version officielle adaptée si besoin, sans le modifier).
- **Jetons** : les variables du `@theme` sont redéfinies sous `:root[data-theme="dark"]` ; le jeton `white` est renommé `surface` (sens, pas couleur).
- **Stockage — exception à « rien de stocké » (é5 D2)** : **une seule clé** `localStorage`, `pepite-theme`, écrite **seulement quand l'utilisateur passe en clair** (valeur `light`) et **supprimée** quand il revient au sombre (le défaut). Toujours dans `try/catch` (navigation privée, stockage bloqué : le thème marche, il n'est simplement pas retenu).
  - Lecture **avant le premier affichage** (petit script en ligne dans `web/index.html`, `data-theme="dark"` par défaut sur `<html>`), pour éviter un flash de thème.
  - Ni cookie, ni `sessionStorage`, ni IndexedDB ; l'historique et les résultats ne sont toujours jamais stockés.
- **À mettre à jour** : le texte « on garde rien » (Claude Web, D8), le test Playwright de stockage (n'autorise que cette clé, avec cette valeur), `contexte/decisions.md` (ligne « rien de stocké »), `CLAUDE.md` (« aucun stockage dans le navigateur au MVP »), `docs/design-system.md` (§2 et §7).

### D8. Emplacements des textes (Claude Web)

- Tous les textes nouveaux ou réécrits passent par `web/src/content/` (un module par page : `apropos.ts`, `commentCaMarche.ts`, `contact.ts`, `exportHelp.ts`, `theme.ts`, `cards.ts`). Tant qu'un texte manque, la constante vaut `pending('<id>')`, qui s'affiche « [texte à venir : <id>] ».
- Un test Vitest liste les `pending` restants ; **bloquant à partir de R7**.
- Liste des emplacements à remettre à Thibault pour Claude Web (avec, pour chacun, la contrainte de longueur et le ton de `docs/design-system.md` §4) :

| Id | Où | Contenu attendu |
|---|---|---|
| `apropos.intro`, `apropos.pourquoi` | à propos | qui je suis (« je », sans école), pourquoi ce site |
| `ccm.modele`, `ccm.percentiles`, `ccm.curseur`, `ccm.donnees`, `ccm.limites`, `ccm.inspirations` | comment ça marche | une section chacun (D2) |
| `ccm.onGardeRien` | comment ça marche | liste « × … », avec l'exception du thème (D7) |
| `contact.intro`, `contact.sujets` (4 libellés), `contact.aideMessage` (dont « film mal reconnu »), `contact.bouton`, `contact.copie`, `contact.copieEchec`, `contact.pasDeMail` | contact | D3 |
| `aide.titre`, `aide.letterboxd.1-3`, `aide.imdb.1-4`, `aide.precedent`, `aide.suivant` | accueil | D4 (une à deux phrases par étape) |
| `theme.versClair`, `theme.versSombre` | en-tête | D7 |
| `cartes.parceQue1`, `cartes.parceQue2`, `cartes.parceQueVu1`, `cartes.parceQueVu2` | cartes | D6 (1 et 2 films aimés ; repli « vu » sans notes) |
| `nav.*` | en-tête | « comment ça marche », « à propos », « contact » (par défaut ces trois-là) |

- Les mentions obligatoires (TMDB, MovieLens) et les libellés techniques (« ★ 3,9 · 1 240 notes ») ne sont pas dans cette liste.

---

## 4. Sous-étapes

### R0 — Emplacements des textes

- `web/src/content/` et `pending()` (D8), test des `pending` restants (non bloquant jusqu'à R7). Liste des emplacements prête à transmettre.

### R1 — Thème sombre

- Jetons des deux thèmes, renommage `white` → `surface`, script en ligne de `index.html`, bouton de thème, clé `pepite-theme` (D7).
- Test Vitest : contrastes calculés depuis les jetons des deux thèmes (texte ≥ 4,5:1, bordures de composants ≥ 3:1).
- Playwright : axe 0 violation grave **dans les deux thèmes**, sur l'accueil, l'analyse, les résultats ; stockage : vide sans clic, exactement `{ "pepite-theme": "light" }` après le passage en clair, retenu après rechargement, vide après le retour au sombre.
- `docs/design-system.md` : palette sombre.

### R2 — Pages et navigation

- Ancres (D2), `CommentCaMarche.tsx`, `APropos.tsx`, `Contact.tsx` (coquille), en-tête commun, « ← changer de fichier » déplacé, `aria-current`.
- Vitest : ancre → page, ancre de section → page + section, fermeture vers `#` qui retrouve les résultats au même cran. Playwright : lien direct `/#contact` au chargement, précédent / suivant.

### R3 — Contact

- Adresse + copier, formulaire, `mailtoHref` (D3).
- Vitest : `mailtoHref` (accents, retours à la ligne, `&`, `?`, `#`, 2 000 caractères), champs obligatoires, aucun envoi. Playwright : aucune requête au clic, rien de stocké.

### R4 — Aide des exports

- `ExportHelp` (onglets, étapes, boutons, `aria-live`), 7 SVG (D4).
- Vitest + RTL : clavier des onglets, boutons aux extrémités, annonce de l'étape. Playwright : téléphone (pas de défilement horizontal), axe dans les deux thèmes ; taille des SVG.

### R5 — Note du public

- `site_catalog.py` (`v: 2`, `ml_mean`, `ml_count`), `catalog-verify`, tests `pytest` ; `export.py catalog --out web` ; type `CatalogFile`, `FilmCard` (D5).
- Mesure de la taille de `catalog.json` (gzip) dans la section 5.

### R6 — Explications

- `explain.ts`, appel dans `workerCore.ts`, affichage dans `FilmCard`, `reco-report` (terminal) (D6).
- Vitest : vecteurs synthétiques (les deux plus proches, seuil de percentile, cosinus ≤ 0 exclu, 0 / 1 / 2 films aimés, films vus jamais cités deux fois sur une carte), invariance à l'échelle int8. `reco-bench` : temps avant / après. Playwright : changement de cran ≤ 50 ms.
- Mesure informative sur l'export de Thibault (D6), comptes seulement dans la section 5.

### R7 — Textes de Claude Web (**arrêt** si des textes manquent)

- Thibault fournit les textes (D8) et vérifie les noms de menus de l'aide (D4) sur les vrais sites. Intégration ; le test des `pending` devient bloquant ; tests de composants mis à jour (anciens libellés « qui on est »…).

### R8 — Vérifications et clôture

- Tous les critères ci-dessous ; adresse de contact confirmée (sinon **arrêt**).
- **Essai sur un vrai téléphone par Thibault**, dans les deux thèmes (**arrêt**).
- Section 5 complète ; `CLAUDE.md` (stockage, arborescence), `docs/design-system.md`, `docs/stack-technique.md` (§9), `contexte/` (état, décisions — exception de stockage —, feuille de route : étape 6b, explications avancées) dans le même commit ; **arrêt** pour relecture.

### R9 — Retouches après l'essai de Thibault (ajoutée le 8 novembre 2026)

1. Tampon « ✱ pépite » en haut à droite de l'affiche (il ne chevauche plus l'explication) ; téléphone et deux thèmes.
2. Explications absentes aux crans bas : **diagnostic d'abord** (par cran, sur l'exemple et sur l'export de Thibault : cartes expliquées, et pourquoi pas les autres). Plafond de diversité → renvoyer plus de voisins (20) et remesurer ; cosinus ≤ 0 → **arrêt** et proposition de la décomposition du score de Hu, Koren et Volinsky (2008).
3. Aide des exports ouverte par défaut, juste sous la zone de dépôt.
4. Site élargi : conteneur ~1 200 px, titres et contenu alignés à gauche sur l'en-tête, paragraphes à ~65 caractères ; téléphone, tablette, grand écran, deux thèmes.
5. Nouveaux textes : `apropos.intro` (lien vers le code), `ccm.inspirations` en liste de liens (nouvel onglet, `rel="noopener"`, titres d'articles en `lang="en"`).

### Critères de réussite

| Critère | Seuil |
|---|---|
| Qualité | `npm test`, `typecheck`, `lint`, `format:check`, `build`, `e2e` verts ; `pytest`, `ruff check`, `ruff format --check` (pipeline touché en R5) |
| Accessibilité | axe : **0 violation grave dans chaque thème**, sur accueil, analyse, résultats, les trois pages ; onglets et carrousel au clavier ; zones tactiles ≥ 44 px |
| Contraste | AA pour tous les couples texte / fond des deux thèmes (test sur les jetons) ; aucun orange |
| Réseau | **0 requête nouvelle** : test `fetch` et Playwright (seules les affiches TMDB hors du site), y compris contact et copie |
| Stockage | rien sans clic ; seule la clé `pepite-theme` = `light` après le passage en clair ; ni cookie, ni `sessionStorage`, ni IndexedDB |
| Liens directs | `#comment-ca-marche`, `#a-propos`, `#contact` et les ancres de sections ouvrent la bonne page au chargement ; retour vers `#` sans recalcul |
| Taille | `catalog.json` ≤ +60 Ko gzip ; SVG de l'aide ≤ 25 Ko au total |
| Temps | `recommend` + explications ≤ +100 ms pour 3 000 films (`reco-bench`) ; changement de cran ≤ 50 ms (Playwright) ; modèle prêt et analyse : pas plus de 10 % au-dessus des temps de l'étape 5 |
| Moteur | les 22 cas de `foldin_cases.json` rejoués à l'identique (les explications n'y touchent pas) |
| Téléphone | une colonne, pas de défilement horizontal, navigation sur deux lignes au plus (Playwright) ; validé sur un vrai téléphone dans les deux thèmes |
| Textes | aucun `pending` restant ; mentions obligatoires intactes ; « Letterboxd » / « IMDb » jamais dans le nom ni le logo, aucun logo de marque dans l'aide |
| Confidentialité | aucun titre de l'export de Thibault dans un fichier versionné |

---

## 5. Résultats

### R0 — Emplacements des textes (8 novembre 2026)

- `web/src/content/` : `pending.ts`, `nav.ts`, `theme.ts`, `apropos.ts`, `commentCaMarche.ts`, `contact.ts`, `exportHelp.ts`, `cards.ts`. Les libellés courts dont la spec donne la valeur (navigation, bouton de thème, « ← précédent / suivant → », sujets du contact, format des explications) sont écrits ; les textes longs valent `pending('<id>')`.
- `content.test.ts` compte les `pending` restants (non bloquant, `BLOCKING = false` jusqu'à R7).

### R1 — Thème sombre (8 novembre 2026)

- Jetons sombres sous `:root[data-theme='dark']` (valeurs de D7), jeton `white` renommé `surface`, ombre des cartes en variable `--shadow-photo` (filet 1 px `rule` en sombre), `color-scheme` par thème.
- `index.html` : `data-theme="dark"` par défaut, petit script en ligne qui lit `pepite-theme` avant le premier affichage ; `web/src/theme.ts` (écrit `light`, supprime la clé au retour au sombre, `try/catch`) ; `ThemeToggle` dans l'en-tête.
- `web/src/styles/contrast.test.ts` : contrastes calculés depuis `index.css`, AA pour `ink`, `muted`, `pen` sur `paper` et `surface` dans les deux thèmes, bordures ≥ 3:1, aucun orange : vert.
- Playwright : axe **0 violation grave dans les deux thèmes** (accueil, analyse Letterboxd et IMDb, résultats) ; test du thème : sombre même avec un système en clair, fond `rgb(22, 23, 27)`, rien de stocké sans clic, exactement `{ "pepite-theme": "light" }` après le passage en clair, retenu au rechargement, vide après le retour au sombre.
- `docs/design-system.md` v0.2 : §2b « thème sombre ».

### R2 — Pages et navigation (8 novembre 2026)

- `web/src/pages/pages.ts` (ancres de pages et de sections), `CommentCaMarche.tsx` (7 sections : `modele`, `percentiles`, `curseur`, `donnees`, `on-garde-rien`, `limites`, `inspirations`), `APropos.tsx` réduit (textes D1 + section `#mentions` « crédits » avec les mentions obligatoires, inchangées), `Contact.tsx` (coquille, R3), `PageSection.tsx`.
- En-tête commun à tous les écrans : logo, « comment ça marche », « à propos », « contact » (`aria-current="page"` sur la page ouverte), bouton de thème ; « ← changer de fichier » en haut du contenu ; « ← retour » (`#`) sur les pages.
- **Écart de mise en œuvre** : en ouvrant une page, l'écran des résultats était démonté et perdait le cran du curseur. L'état d'affichage (cran, nombre de cartes, « sans les documentaires ») est désormais gardé par `App` (`web/src/pages/resultsView.ts`) : retour au même cran, mêmes cartes, sans recalcul.
- Vitest : ancres, lien direct au chargement, retour au même cran. Playwright : les trois pages par-dessus les résultats (axe deux thèmes), précédent / suivant, « ← retour » → 16 cartes au même cran, liens directs `/#contact` et `/#on-garde-rien` (section visible) ; téléphone : navigation et bouton de thème sur **2 lignes** sous le logo, aucun défilement horizontal. Temps : changement de cran ≤ 46 ms.

### R3 — Contact (8 novembre 2026)

- `web/src/pages/Contact.tsx`, `contactMail.ts` (`mailtoHref`). Adresse en `<code>` sélectionnable (`select-all`) + « copier » (`navigator.clipboard`, sinon sélection de l'adresse), message dans une zone `aria-live`. Formulaire : `<fieldset>` de 4 radios (aucun coché), `<textarea>` 2 000 caractères avec compteur ; erreurs (« choisis un sujet. », « écris-nous un message. ») en `role="alert"` ; envoi = `window.location.assign(mailto:…)`, sujet `[pépite] <sujet>`, corps = le message seul.
- Vitest (5) : encodage (accents, `&`, `?`, `#`, retours à la ligne en `%0D%0A`, 2 000 caractères), copie et repli, champs obligatoires, aucun `fetch`. Playwright : copie relue dans le presse-papiers, envoi du formulaire sans aucune requête hors du site, rien de stocké ; axe 0 dans les deux thèmes.
- Adresse : toujours `[ADRESSE À CONFIRMER]` (décision en R8).

### R4 — Aide des exports (8 novembre 2026)

- `web/src/components/ExportHelp.tsx` : onglets ARIA (« letterboxd », « imdb » ; flèches, Début / Fin, tabindex itinérant), 3 et 4 étapes, « étape n sur m » + texte dans une zone `aria-live="polite"`, « ← précédent » / « suivant → » désactivés aux extrémités, chaque onglet garde son étape ; aucune animation. Affiché sous « je sais pas où trouver mon export » (bouton dépliant gardé).
- `web/src/components/help/illustrations.tsx` : 7 schémas au trait (fenêtre, lignes simulées, boucle et flèche au stylo, fichier, zone de dépôt en pointillés), jetons `ink` / `pen` / `surface` seulement, `aria-hidden`. **Aucun mot dans les dessins** sauf `.zip`, `.csv` et « … » : les noms de menus sont dans le texte de l'étape (langue de l'utilisateur, vérifiée en R7). **8 130 octets** pour les 7 (832 à 1 875 chacun ; plafonds 3 000 et 25 000).
- Les deux paragraphes d'aide de l'étape 6 sont remplacés par les emplacements `aide.*` (ils restent dans l'historique git, utiles à Claude Web).
- Vitest (3) : clavier des onglets, étapes et extrémités, budget et contenu des SVG (ni couleur en dur, ni image, ni mot). Playwright (téléphone) : aide ouverte sans défilement horizontal, axe 0 dans les deux thèmes, onglet IMDb jusqu'à l'étape 4.

### R5 — Note du public (8 novembre 2026)

- `site_catalog.py` : `catalog.json` **v2**, `ml_mean` (moyenne MovieLens × 10, arrondie au plus proche, 0,5 vers le haut, après `round(…, 6)` pour éviter 3,05 × 10 = 30,4999…) et `ml_count` ; `export.py catalog-verify` contrôle la version, les longueurs et les bornes (5 ≤ `ml_mean` ≤ 50, `ml_count` ≥ 1). `pytest` 232 verts, `ruff` propre. Pas de réentraînement (ordre `item_idx` inchangé).
- **Taille** : `catalog.json` 2 699 074 octets, **1 172 359 gzip** (+55 105, +4,9 %, plafond +60 Ko) ; total `web/public/data/` **3 115 774 octets gzip**.
- Site : `FilmCard.publicRating` (`mean10`, `count`) lu dans le worker ; ligne « ★ 3,9 · 1 240 notes » (encre pâle 13 px, `Intl.NumberFormat('fr-FR')`, espace fine insécable), « ★ … » `aria-hidden`, texte lu : « note moyenne 3,9 sur 5, 1 240 notes ». Champs facultatifs dans `CatalogFile` : un ancien `catalog.json` (v1) donne des cartes sans la ligne.
- Tests : format, carte avec et sans note (Vitest) ; sur les vrais fichiers, chaque film recommandé a sa note et **`ml_count` ≤ popularité ≤ plafond du cran** (worker) ; Playwright : 8 lignes de note sur les 8 premières cartes.
- **Temps du curseur** : la mesure Playwright compte jusqu'à deux images après la mise à jour (plancher ≈ 33 ms) ; elle donne maintenant aussi le temps jusqu'au DOM (`notchDomMs` : **3 à 8 ms**). Sur une machine chargée, des pointes isolées à 50–69 ms sont apparues (rendu des affiches, pas React) ; en alternant 2 × 5 mesures avec et sans R5 : 34–46 ms avec, 34–50 ms sans. **Pas d'effet de la note du public** ; seuil de 50 ms gardé.

### R6 — Explications (8 novembre 2026) — ⚠️ arrêt : règle de diversité à décider

- `web/src/reco/explain.ts` (`explain`, `explanationPool`) : pool = films notés de percentile ≥ 0,7 (`LIKED_PERCENTILE`), sinon, **si aucune entrée n'a de note**, tous les films vus (« vu ») ; cosinus sur les vecteurs déquantifiés (normes du pool précalculées), cité seulement si cosinus > 0 (`MIN_COSINE`), 2 au plus (`MAX_CITED`), ordre du plus proche ; à égalité, le plus petit `item_idx`.
- Worker : calcul unique après `recommend`, sur les films distincts des 8 crans, **sauf ceux qui ont une annotation de série** (Q3) ; `RecommendedFilm.because = { kind, titles }`, `RecommendResult.explainMs`. Interface : annotation Caveat sous la ligne de note, titres > 32 caractères coupés avec « … » (texte complet en `sr-only`), **masquée aux crans « loin de tes goûts »** (Q4). Le changement de cran ne recalcule rien.
- Tests : Vitest (`explain.test.ts` 6 cas : deux plus proches, seuil de percentile, cosinus ≤ 0, un seul film, aucune note → « vu », notes sans film aimé → rien ; carte : coupe, `sr-only`, « vu », série prioritaire ; résultats : masquée au cran 500 du jeu de test) ; vrais fichiers : films cités ∈ historique, jamais avec une série ; **les 22 cas de `foldin_cases.json` toujours rejoués à l'identique** ; Playwright : explication visible sur les cartes, axe 0 dans les deux thèmes, changement de cran ≤ 50 ms (`notchDomMs` 3 à 6 ms).
- **Temps** (`reco-bench`, médiane de 7, `recommend` 8 × 48) : explications **3,5 ms** (export de Thibault, 188 films), 4,7 ms (225), 14,7 ms (1 000), **38,1 ms (3 000)** ; plafond +100 ms respecté. `recommend` complet : 24,6 / 22,5 / 39,6 / 86,7 ms (avant R6 : 17,7 / 18,9 / 41,9 / 76,7 ms, n = 50).
- **Mesure informative (D6)**, `reco-report` (terminal ; comptes seulement), 8 premières cartes de chaque cran, nombre de films cités distincts / nombre de cartes où apparaît le film le plus cité :

| Cran | ∞ | 20 000 | 10 000 | 5 000 | **2 000 (départ)** | 1 000 | 500 | 200 |
|---|---|---|---|---|---|---|---|---|
| Export de Thibault (188 films) | 15 / 2 | 12 / 2 | 11 / 3 | 7 / 3 | **4 / 6** | 5 / 6 | 6 / 5 | 5 / 6 (masqué) |
| Export d'exemple (61 films) | 6 / 4 | 7 / 6 | 6 / 5 | 7 / 3 | **5 / 7** | 4 / 7 | 3 / **8** | 3 / **8** |

  Aucune carte sans explication (hors séries). Sur la capture du cran 2 000 de l'exemple, les deux mêmes films sont cités ensemble sur 5 cartes sur 8.
- **Arrêt (D6)** : un même film est cité sur presque toutes les cartes dès le cran de départ (7/8 sur l'exemple, 6/8 sur l'export de Thibault), et sur toutes aux crans 500 et 200 de l'exemple. Une règle de diversité sort des décisions écrites : à trancher par Thibault (options dans le message d'arrêt). R7 attend aussi les textes de Claude Web.

**Décision de Thibault (8 novembre 2026) : option A.** Sur une rangée de 8 cartes (ordre affiché, comme le tampon « ✱ pépite »), un film de l'historique n'est cité que sur **2 cartes au plus** ; au-delà, on prend le suivant le plus proche (cosinus > 0) ; s'il n'y en a pas, un seul film, ou aucun. Test du curseur : 50 ms **sur la médiane** de plusieurs mesures, pire cas journalisé sans être bloquant.

- Mise en œuvre : le worker garde jusqu'à **5 candidats** par film (`CANDIDATES`, `because.items` + `titles`) ; la grille choisit (`citationPicks`, `web/src/components/cardRules.ts`, `MAX_CITATIONS_PER_BLOCK = 2`). `reco-report` applique la même règle.
- Mesure après la règle (8 premières cartes de chaque cran) : le film le plus cité l'est sur **2 cartes au plus à tous les crans**, sur les deux exports. Export de Thibault : 15 / 12 / 11 / 8 / **5** / 7 / 7 films cités distincts de ∞ à 500 ; au cran 2 000, 2 cartes avec un seul film et **2 sans explication** (candidats épuisés), 2 et 1 sans explication à 1 000 et 500. Export d'exemple : 6 à 10 films distincts par cran, 0 à 2 cartes avec un seul film, 1 carte sans explication au cran 200.
- Test du curseur : 3 passages sur 7 changements de cran (21 mesures), critère sur la médiane ; 3 exécutions : médiane **33 ms**, pire cas 36 à 54 ms (journalisé).

### R7 — Textes de Claude Web (8 novembre 2026)

- Textes reçus de Thibault (rédigés avec Claude Web) et intégrés dans `web/src/content/`, une entrée par paragraphe ou élément de liste : `apropos.*` (2 + 3 paragraphes, « je », sans école), `ccm.*` (4 + 3 + 4 + 4 paragraphes, 5 + 5 éléments de liste, 4 paragraphes d'inspirations ; « on garde rien » cite l'exception du thème clair et le `mailto:`), `contact.*` (sujets « un bug », « un film mal reconnu », « une idée », « autre chose » ; erreur « écris-moi un petit message. »), `aide.*` (3 + 4 étapes). Navigation, bouton de thème et format des explications validés tels quels.
- **Libellés anglais des autres sites** (« settings », « data », « export your data », « letterboxd recommendations ») : marqués `{en:…}` dans le contenu, rendus en `<span lang="en">` par `RichText` (`web/src/content/richText.ts`, testé).
- `content.test.ts` : **bloquant**, 0 `pending` restant.
- Noms de menus : **IMDb vérifié par Thibault** (chemin du texte) ; **Letterboxd : la ligne de confirmation du message de Thibault est restée à remplir** (« [OK tel quel / ou corrige ici] ») : à confirmer en R8.
- Vitest 251 verts, Playwright 8 verts (axe 0 dans les deux thèmes sur les trois pages avec leurs vrais textes ; logo TMDB lisible sur fond sombre, vérifié sur capture).

### R8 — Vérifications (8 novembre 2026) — ⏸ arrêt : adresse, menus Letterboxd, téléphone

| Critère | Résultat |
|---|---|
| Qualité | `ruff check` et `ruff format --check` propres, `pytest` **232** verts ; `npm test` **251** verts (19 fichiers, dont les tests sur les vrais fichiers), `typecheck`, `lint`, `format:check`, `build` verts ; `e2e` **8** verts |
| Accessibilité | axe : **0 violation grave dans chaque thème** sur l'accueil (aide ouverte comprise), l'analyse (Letterboxd et IMDb), les résultats, « comment ça marche », « à propos », « contact » ; onglets et carrousel au clavier (Vitest) ; zones tactiles ≥ 44 px (Playwright, téléphone) |
| Contraste | AA pour `ink`, `muted`, `pen` sur `paper` et `surface` dans les deux thèmes, bordures ≥ 3:1, aucun orange (`contrast.test.ts`) ; logo TMDB lisible sur fond sombre |
| Réseau | 0 requête nouvelle : seules les affiches TMDB sortent du site, y compris pages, copie et formulaire de contact (Playwright) ; aucun `fetch` dans le contact (Vitest) |
| Stockage | rien sans clic ; exactement `{ "pepite-theme": "light" }` après le passage en clair, retenu au rechargement, vide au retour au sombre ; ni cookie, ni `sessionStorage`, ni IndexedDB |
| Liens directs | `/#contact`, `/#on-garde-rien` (section visible) au chargement ; précédent / suivant ; « ← retour » → mêmes cartes, même cran |
| Taille | `catalog.json` +55 Ko gzip (plafond +60) ; SVG de l'aide 8 130 octets (plafond 25 000) |
| Temps | explications 3,5 ms (export réel) à 38,1 ms (3 000 films), plafond +100 ms ; changement de cran : médiane **33 ms** (21 mesures, plafond 50), pire cas journalisé ; modèle prêt 0,7-1,0 s, analyse de l'exemple 10-17 ms (étape 5 : 0,8-0,9 s, 11-30 ms) |
| Moteur | 22 cas de `foldin_cases.json` rejoués à l'identique |
| Téléphone | Playwright 375 × 812 : une colonne, pas de défilement horizontal (accueil, aide ouverte, analyse, résultats), navigation sur 2 lignes ; **essai sur un vrai téléphone : à faire par Thibault** |
| Textes | 0 `pending` ; mentions obligatoires intactes (tests) ; aucun nom de marque dans le nom ni le logo, aucun logo dans l'aide |
| Confidentialité | aucun titre ni pseudo d'un export dans un fichier versionné (mesures : comptes seulement) |

- **Documents de clôture préparés dans ce commit** (`CLAUDE.md`, `docs/stack-technique.md` §6, §8, §9, `docs/design-system.md` §5 et §7, `contexte/`) : ils décrivent l'étape 6b comme faite **sauf** les trois points ci-dessous.
- **Arrêt** (R8) :
  1. **adresse de contact** : toujours `[ADRESSE À CONFIRMER]` (`CONTACT_EMAIL`, `web/src/content/contact.ts`) ;
  2. **noms des menus Letterboxd** de l'aide (« settings », onglet « data », « export your data ») : la confirmation de Thibault est restée à remplir ;
  3. **essai sur un vrai téléphone** dans les deux thèmes (`npm run dev -- --host`).

### R9 — Retouches après l'essai de Thibault (8 novembre 2026)

- **Tampon « ✱ pépite »** : en haut à droite de l'affiche (`top-5`, déborde de 8 px), sur une petite étiquette `surface` pour rester lisible sur n'importe quelle affiche. Playwright (téléphone, tablette, grand écran ; sombre et clair) : le bas du tampon reste au-dessus du bas de l'affiche, aucun défilement horizontal. Un premier essai à −14 px, avec une marge de 16 px sur téléphone, débordait de l'écran : marge de 24 px gardée, tampon à −8 px.
- **Diagnostic des explications** (`reco-report`, 16 premières cartes par cran ; comptes seulement) avec 5 candidats : **aucune carte sans explication à cause du cosinus**. Causes : plafond de diversité épuisé (export de Thibault : 2, 2 et 1 cartes aux crans 2 000, 1 000 et 500 ; exemple : 1 au cran 200), cartes de série (1 à 5 000 et à 500), et surtout **le cran 200 de l'export de Thibault entier (16/16) masqué** parce qu'il est « loin de tes goûts » (score relatif 0,020 < 0,04, règle Q4). Pas d'arrêt (ce n'est pas le cosinus).
- **20 candidats** (`CANDIDATES = 20`) : plus aucune carte bloquée par le plafond ; toutes les cartes sont expliquées sauf les séries et le cran « loin de tes goûts ». Coût (`reco-bench`, médiane de 7) : explications **8,2 ms** (export de Thibault), 12,4 ms (225 films), 25,6 ms (1 000), **49,5 ms (3 000)** ; plafond de +100 ms respecté.
- ⚠️ **À noter pour Thibault** : tout à droite sur son export, l'absence d'explication vient de la règle Q4 (« pas d'explication sur les cartes loin de tes goûts »), pas du calcul. La lever est une décision (§6).
- **Aide des exports** : ouverte par défaut (`aria-expanded="true"`), juste sous la zone de dépôt, avant les promesses et le lien d'exemple ; le bouton la replie.
- **Mise en page** : un seul conteneur **1 200 px** (marges 24 px) pour tous les écrans, aligné sur l'en-tête ; paragraphes des pages à **65ch** ; titre et curseur des résultats, écran d'analyse à 760 px ; la grille des résultats prend toute la largeur (4 colonnes sur grand écran). Playwright : téléphone 375, tablette 768, grand écran 1 440, deux thèmes : pas de défilement horizontal, titre aligné sur le logo, `main` ≤ 1 200 px, axe 0.
- **Textes** : `apropos.intro` (4 paragraphes, lien « le code est sur github »), `ccm.inspirations` devenue une **liste** de 6 éléments avec 5 liens. Marquage étendu : `{a:url|libellé}` et `{a-en:url|libellé}` (lien externe, nouvel onglet, `rel="noopener noreferrer"`, « (nouvel onglet) » pour les lecteurs d'écran, `https` obligatoire) ; titres d'articles en `lang="en"`. `aide.letterboxd.1` précisé (« passe sur ton nom en haut de la page et ouvre « settings » »), menus Letterboxd confirmés par Thibault (« settings » → « data » → « export your data »).
- Qualité : Vitest **254**, Playwright **11** (dont 3 de mise en page), `typecheck`, `lint`, `format:check`, `build` verts ; changement de cran : médiane 33 ms, pire cas 35-48 ms.
- **Adresse de contact** : donnée par Thibault après R9, en place dans `CONTACT_EMAIL` (`web/src/content/contact.ts`).
- **Reste pour clore** : l'essai sur un vrai téléphone dans les deux thèmes (Thibault).

---

## 6. À reporter

- **Explication exacte de l'ALS** (contribution de chaque film de l'historique au score) : plus fidèle que le cosinus, à comparer avec la fiche film (étape 8).
- **Règle de diversité des films cités** (éviter le même film sur toutes les cartes), si la mesure de R6 le demande sans justifier un arrêt.
- **Suivre le thème du système** (`prefers-color-scheme`) quand rien n'est choisi : écarté (Q2, sombre par défaut même si le système est en clair).
- **Explications aux crans « loin de tes goûts »** : masquées par Q4 ; sur l'export de Thibault, tout le cran 200 l'est (R9). À rediscuter avec les volontaires.
- **Décomposition du score de l'ALS** (Hu, Koren, Volinsky 2008) : non nécessaire au diagnostic de R9 (aucune carte sans voisin à cosinus > 0) ; reste une option pour la fiche film.
- **Seuils des explications** (percentile ≥ 0,7, cosinus > 0) : à recaler avec les retours des volontaires (étape 7) (Q4).
- **Formulaire de contact relié à un service** (envoi sans application de mail) : demanderait un service tiers ou un Worker ; à rediscuter avec « forme du retour des volontaires » (étape 7).

---

## 7. Questions pour la validation — réponses de Thibault (8 novembre 2026)

1. **Q1 — Cartes en thème sombre** : surface sombre, un cran plus claire que le fond, scotch gardé (on doit toujours lire une « photo »). → D7.
2. **Q2 — Sombre même si le système est en clair** : oui. → D7.
3. **Q3 — Film d'une série déjà vue** : l'annotation de série remplace l'explication. → D6.
4. **Q4 — Seuils** : percentile ≥ 0,7 et cosinus > 0 au départ (à recaler avec les volontaires, §6) ; **pas d'explication sur les cartes « loin de tes goûts »** ; un seul film au-dessus du seuil → « parce que t'as aimé X » ; aucun → rien ; historique sans notes → repli sur tous les films vus, « parce que t'as vu X et Y ». → D6.
5. **Q5 — Libellés** : « qui on est » devient « à propos » ; pied de page inchangé. → D1, D2.
6. **Q6 — Adresse de contact** : décidée en R8 (adresse dédiée probable) ; l'emplacement reste. → D3.
