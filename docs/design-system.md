# Design system — direction « C · Fanzine »

> Version 0.2 (8 novembre 2026 : thème sombre, étape 6b). Version 0.1 : 6 novembre 2026. Référence visuelle : `maquette-C-fanzine.html` (ouvrir dans un navigateur).
> Nom de travail du site : **Pépite** (temporaire).

---

## 1. L'esprit en une phrase

**Un programme de ciné-club photocopié : minimaliste mais artisanal. On ne vend rien, on partage des films.**

Ce qu'on veut :
- simple, honnête, un peu drôle ;
- l'impression que c'est fait à la main par des gens qui aiment le cinéma ;
- les affiches de films comme récompense à la fin du parcours.

Ce qu'on refuse :
- tout ce qui fait « startup » : dégradés, gros boutons marketing, chiffres de vente, « rejoignez 10 000 cinéphiles » ;
- **orange sur fond sombre** (ressemblance avec un autre site, à éviter absolument) ;
- emoji dans l'interface ;
- un ton commercial ou trop sérieux.

---

## 2. Couleurs

| Rôle | Nom | Valeur | Usage |
|---|---|---|---|
| Fond | papier | `#FBFAF7` | Fond de toutes les pages |
| Surface | surface (`surface`, ex-`white`) | `#FFFFFF` | Zone de dépôt, bouton principal, cartes « photo » des affiches |
| Texte | encre | `#1B1B1B` | Tout le texte principal, bordures fortes |
| Texte secondaire | encre pâle | `#555049` | Descriptions, réalisateur/année, liens secondaires |
| Filets | trait | `#B9B4AA` | Pointillés de séparation (pied de page) |
| Accent | **stylo bleu** | `#2546B8` | Annotations manuscrites, pépites, curseur, soulignés |
| Scotch | scotch | `rgba(214, 208, 196, 0.75)` | Bout de scotch sur les affiches |

Règles :
- **Un seul accent** : le stylo bleu. Il ne sert qu'à ce qui est « écrit à la main » et à ce qui est une pépite.
- Les **affiches** sont la seule autre source de couleur.
- Variantes de stylo possibles plus tard : rouge `#B8322A` ou noir. Le bleu reste la valeur par défaut.

Accessibilité : `#1B1B1B` et `#555049` sur `#FBFAF7` passent le contraste AA. Le bleu `#2546B8` aussi.

### 2b. Thème sombre (par défaut depuis l'étape 6b)

Le site s'ouvre en **sombre**, même si le système est réglé en clair ; un bouton de l'en-tête (« passer en clair ») bascule. Le choix du clair est la seule chose retenue par le navigateur (clé `pepite-theme`, `docs/etape-6b-retouches.md`, D7).

| Rôle | Jeton | Sombre | Contraste (fond / surface) |
|---|---|---|---|
| Fond | `paper` | `#16171B` | — |
| Surface (cartes, zone de dépôt, bouton) | `surface` | `#23242A` | un cran plus clair que le fond |
| Texte | `ink` | `#ECE8DF` | 14,7 / 12,7 |
| Texte secondaire | `muted` | `#ADA79C` | 7,5 / 6,5 |
| Filets (décoratifs) | `rule` | `#5A574F` | 2,5 |
| Accent : stylo bleu éclairci | `pen` | `#8EA6FF` | 7,7 / 6,7 |
| Scotch | `tape` | `rgba(214, 208, 196, 0.35)` | — |

Règles :
- mêmes règles qu'en clair : un seul accent (le stylo), **jamais d'orange** ;
- les cartes restent des « photos » : surface un cran plus claire que le fond, **scotch gardé** ; l'ombre, invisible, devient un filet 1 px `rule` (`--shadow-photo`) ;
- toute bordure de composant est en `ink` (≥ 3:1) ; `rule` ne sert qu'aux séparations décoratives ;
- `color-scheme: dark` pour les contrôles natifs ;
- vérifié par `web/src/styles/contrast.test.ts` (AA pour chaque couple texte / fond, dans les deux thèmes).

---

## 3. Typographie

| Rôle | Police | Graisse | Taille |
|---|---|---|---|
| Tout le texte de l'interface | **Courier Prime** (police des scénarios de cinéma) | 400 / 700 | 13–18 px |
| Titres de page | Courier Prime | 400 | `clamp(26px, 3.4vw, 38px)`, interligne 1.35 |
| Logo « pépite » | Courier Prime | 700 | 22 px |
| Annotations manuscrites | **Caveat** | 500 / 700 | 20–26 px, toujours en stylo bleu |

Chargement : **polices auto-hébergées**, aucune requête vers Google (décision de l'étape 5, D1). Paquets npm sous licence OFL, sous-ensemble latin :
- `@fontsource/courier-prime` : 400, 700, 400 italique ;
- `@fontsource/caveat` : 500, 700.

Ils sont importés dans `web/src/styles/index.css`. (La maquette `maquette-C-fanzine.html` charge encore Google Fonts : c'est une maquette, pas le site.)

Règles :
- Titres en **minuscules**, sans majuscule de début (« salut. »).
- Caveat **uniquement** pour les annotations (petites phrases à côté, entre parenthèses, flèches). Jamais pour un texte important à lire.
- Les annotations sont légèrement **inclinées** (`rotate(-1.5deg)` à `rotate(-4deg)`).

---

## 4. Ton et rédaction

- **Tutoiement**, minuscules, phrases courtes.
- Honnête et direct : on dit ce qu'on fait et ce qu'on ne fait pas.
- Un peu d'humour, jamais de second degré méprisant (« jamais snob »).
- On parle **cinéma**, pas algorithme.

Exemples validés (maquette C) :
| Endroit | Texte |
|---|---|
| Titre d'accueil | « salut. donne-nous ta liste de films, on te trouve ceux que t'as pas encore vus. » |
| Zone de dépôt | « glisse ton fichier ici » / « l'export de letterboxd (le .zip) ou tes notes imdb (le .csv) » |
| Annotation | « c'est là » (avec une flèche dessinée) |
| Promesses | « × pas de compte à créer » / « × pas de pub, pas de tracking » / « × on garde rien : tout se passe dans ton navigateur » |
| Lien exemple | « montre-moi un exemple → » |
| Résultats | « on a lu tes 412 films. voilà huit films que t'as sûrement jamais vus. » |
| Annotation de profil | « (t'aimes bien tarkovski, wenders et ozu, non ?) » |
| Curseur | « plutôt connu ou plutôt pépite ? » — « les classiques » ↔ « les trucs que personne connaît » |
| Bouton | « encore des films » |
| Feedback | « dis-nous si on s'est planté, ça nous aide » |
| Boutons de feedback (sur une reco) | « ça me tente » / « pas pour moi » |
| Pied de page | « fait à la main par des gens qui regardent trop de films. projet indépendant, sans lien avec letterboxd ni imdb. » |
| Films récents (à ajouter) | par ex. « on connaît moins bien les films sortis après 2023, désolé. » |

Mentions obligatoires (ne pas reformuler) :
- TMDB : « This product uses the TMDB API but is not endorsed or certified by TMDB. » + logo TMDB sur la page « à propos ».
- MovieLens : citation de Harper & Konstan (2015) sur la page « à propos », sans laisser croire à un soutien de l'Université du Minnesota.

---

## 5. Composants

### Zone de dépôt
- Fond blanc, **bordure 2 px en pointillés** encre, coins 3 px, padding 32 × 28 px.
- C'est un vrai `<label>` lié à un `<input type="file" accept=".zip,.csv">` (accessible au clavier).
- À côté : annotation Caveat « c'est là » avec une petite flèche SVG en stylo bleu.

### Souligné manuscrit
- SVG ondulé sous un mot-clé du titre (« pas encore vus »), trait 3 px stylo bleu, extrémités arrondies.

### Carte film (« photo scotchée »)
- Fond blanc, padding 12 px (18 px en bas), ombre très légère `0 1px 2px rgba(0,0,0,0.12)`.
- Légère **rotation** différente pour chaque carte (entre −1,8° et +1,8°).
- Un **bout de scotch** (72 × 22 px) centré en haut, légèrement de travers.
- Affiche au format **2:3**.
- Dessous : titre en gras 16 px, puis « réalisateur, année » en encre pâle 13 px, puis la note du public « ★ 3,9 · 1 240 notes » (encre pâle 13 px ; étape 6b).
- Annotation Caveat « (parce que t'as aimé « X » et « Y ») » (étape 6b), ou « (même série que « X », que t'as vu) » qui la remplace ; titres de plus de 32 caractères coupés avec « … ».
- Si c'est une pépite : « ✱ pépite » en Caveat gras, stylo bleu, incliné à −12°, **en haut à droite de l'affiche**, sur une petite étiquette couleur surface, qui déborde un peu du bord droit (étape 6b, R9 : il ne chevauche plus l'explication).
- Toute la carte est un lien vers la fiche du film.

### Grille de résultats
- `grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))`, espacement 56 px vertical × 36 px horizontal (large, pour laisser respirer les rotations).

### Curseur connu ↔ pépite
- `<input type="range">` natif, `accent-color` stylo bleu, hauteur de zone tactile 44 px.
- Libellé au-dessus en gras : « plutôt connu ou plutôt pépite ? ».
- Deux étiquettes sous le curseur : « les classiques » à gauche, « les trucs que personne connaît » à droite.
- Les résultats se mettent à jour **en direct** pendant le glissement.

### Boutons
- Bouton principal : fond blanc, bordure 2 px encre, coins 3 px, texte gras 16 px, hauteur 48 px.
- Liens : soulignés par défaut, deviennent stylo bleu au survol.

### Liste « ce qu'on fait pas »
- Liste sans puces, chaque ligne commence par « × ».

---

## 6. Mise en page

- Un seul conteneur de **1 200 px** au plus pour tous les écrans (étape 6b, R9), aligné sur l'en-tête ; marges latérales 24 px. Les paragraphes gardent une largeur de lecture (**~65 caractères**), les titres des écrans 760 px au plus ; la grille des résultats prend toute la largeur. (Avant : 820 px pour l'accueil, 1 100 px pour les résultats, centrés.)
- Beaucoup de vide, **une action principale par écran**.
- Tout s'aligne à gauche (pas de centrage façon landing page).
- Doit fonctionner sur téléphone : la grille passe à 1 colonne, la flèche « c'est là » passe sous la zone de dépôt.

---

## 7. Écrans prévus

| Écran | État de la maquette | Contenu |
|---|---|---|
| Accueil | ✅ fait (C) | Titre, zone de dépôt, promesses, lien exemple |
| Analyse du fichier | ⏳ à refaire en style C | « on a reconnu 412 de tes films », liste des titres ambigus à corriger |
| Recommandations | ✅ fait (C) | Titre, annotation de profil, curseur, grille de cartes |
| Fiche film | ⏳ à refaire en style C | Grande affiche, résumé, « pourquoi ce film », lien Letterboxd, « je l'ai déjà vu » |
| Comment ça marche | ✅ fait (étape 6b) | Le principe, tes notes, le curseur, les données, on garde rien, limites, inspirations |
| À propos | ✅ fait (étape 6b) | « je » (étudiant, sans école), pourquoi ce site, crédits TMDB / MovieLens |
| Contact | ✅ fait (étape 6b) | Adresse + « copier », formulaire (sujet, message) qui ouvre la messagerie |
| Aide des exports | ✅ fait (étape 6b) | Onglets letterboxd / imdb, étapes avec schémas SVG au trait |

Directions écartées pour l'instant (gardées sur le canevas de maquettes) : A « Lumière » (blanc, cobalt, Inter Tight) et B « Générique » (gris clair, vert, capitales étroites).
