# Projet : recommandeur de films pour cinéphiles

> Document de cadrage — version 0.3 (6 novembre 2026) — décisions intégrées
> Ce qu'on construit, l'identité du site, et ce qu'on garde en tête pour plus tard.

---

## 1. En une phrase

**Un site gratuit où tu déposes ton historique de films (Letterboxd, IMDb ou autre) et qui te recommande des films que tu ne connais pas encore, avec un curseur pour choisir entre films connus et vraies pépites.**

Pitch : *là où les autres te recommandent ce que tout le monde regarde, nous on te trouve les films que tu n'as pas encore découverts.*

---

## 2. Le problème

- Letterboxd est l'endroit où les cinéphiles notent tous leurs films, mais **il n'y a aucune recommandation personnalisée**.
- Son API est fermée aux projets de recommandation.
- Les outils tiers existants sont fragiles (scraping qui casse, sites hors ligne), peu personnalisés, ou grand public (IMDb recommande surtout des blockbusters).
- Le seul concurrent sérieux côté cinéphile (Criticker) date de 2005 et oblige à tout re-noter sur son site.

---

## 3. Identité du site

### Positionnement
« Le Criticker moderne » : **gratuit, sans compte, privé, orienté découverte.**

### Valeurs
- **Découverte avant popularité** : on veut faire découvrir, pas confirmer ce que tout le monde regarde.
- **Respect de la vie privée** : les données restent dans le navigateur de l'utilisateur, rien n'est stocké chez nous.
- **Transparence** : l'utilisateur comprend pourquoi un film lui est recommandé.
- **Ouvert à tous les historiques** : pas réservé aux utilisateurs Letterboxd.

### Ton
Celui d'un ciné-club ou d'un bon disquaire : passionné, précis, jamais snob. On parle cinéma, pas algorithme.

### Nom
**Nom de travail : « Pépite »** (temporaire, le temps de trouver le nom définitif).

Contrainte : **ne pas utiliser « Letterboxd » ni « IMDb » dans le nom** (marques déposées). On peut écrire « compatible avec Letterboxd et IMDb ». Vérifier que le nom de domaine est libre avant de choisir.

Pistes pour le nom définitif :
| Nom | Idée |
|---|---|
| **Pépite** | Colle directement au curseur connu / pépite |
| **Hors-Champ** | Ce qui est en dehors du cadre, ce que tu n'as pas vu |
| **Contrechamp** | Le point de vue inverse, l'autre côté |
| **Ciné-club** | Convivial, cinéphile |
| **Bobine** | Simple, rétro, mémorisable |

### Direction visuelle retenue (pour l'instant) : « C · Fanzine »
Maquette de référence : `maquette-C-fanzine.html` (les directions A « Lumière » et B « Générique » restent sur le canevas de maquettes).

- **Esprit** : un programme de ciné-club photocopié. On ne vend rien, on partage. Minimaliste mais artisanal.
- **Typographie** : **Courier Prime** (la police des scénarios de cinéma) pour tout le texte, **Caveat** (écriture manuscrite) pour les annotations.
- **Couleurs** : papier presque blanc (`#FBFAF7`), encre noire (`#1B1B1B`), **stylo bleu** (`#2546B8`) pour les annotations et les pépites.
- **Ton** : tutoiement, minuscules, un peu d'humour, honnête (« pas de compte, pas de pub, on garde rien »).
- **Affiches** : posées comme des photos scotchées, légèrement de travers, « ✱ pépite » griffonné dessus.
- **Curseur** : « les classiques » ↔ « les trucs que personne connaît ».
- **À éviter** : orange sur fond sombre (ressemblance avec un autre site), tout ce qui fait « startup » ou trop marketing.

---

## 4. Fonctionnalités

### 🎯 MVP (priorité)

**A. Import de l'historique**
- Dépôt d'un fichier CSV (ou du ZIP d'export Letterboxd).
- Formats reconnus au lancement :
  - **Letterboxd** : `ratings.csv` (colonnes Date, Name, Year, Letterboxd URI, Rating — notes de 0,5 à 5).
  - **IMDb** : export des notes (colonnes Const, Your Rating, Title, Year… — notes de 1 à 10). *Colonnes exactes à vérifier sur un vrai export.*
- Détection automatique du format.
- **Normalisation des notes** : ramener toutes les échelles sur une même base (idéalement en percentiles par utilisateur, comme Criticker : un 3★ ne veut pas dire la même chose pour tout le monde).
- **Correspondance des titres** vers un identifiant commun (TMDB / IMDb), avec un écran « films non reconnus » pour corriger à la main.

**B. Recommandations**
- Un modèle de goût entraîné à l'avance sur MovieLens : **ALS** (filtrage collaboratif). EASE sert seulement de comparaison hors ligne.
- Calcul dans le navigateur : pas de serveur, gratuit à héberger.
- On exclut les films déjà vus.
- Affichage : affiche, titre, année, réalisateur, score de correspondance.

**C. Le curseur connu ↔ pépite**
- Un curseur qui fait varier le poids de la popularité :
  - à gauche : classiques et films reconnus qui collent à tes goûts ;
  - à droite : films peu notés mais très proches de ton profil.
- Principe : `score final = pertinence − λ × log(popularité)`, où λ suit le curseur.
- Mise à jour instantanée des résultats quand on bouge le curseur.

### 🧠 À garder en tête (pas prioritaire, mais prévu dans la conception)

**Import élargi**
- **Liste faite à la main** (texte libre, copier-coller, note sur téléphone…) **remise en forme par une IA** : elle reconnaît les titres, devine l'année, propose une note si l'utilisateur en a mis une. L'utilisateur valide avant import.
- Autres sources : Trakt, SensCritique (très utilisé en France), Criticker, exports Netflix.
- → Concevoir l'import comme des **« adaptateurs »** : un adaptateur par source, qui produit toujours le même format interne (`titre, année, id, note normalisée, date`).

**Scraping Letterboxd (en option, en plus du CSV)**
- Entrer un pseudo plutôt que déposer un fichier : plus simple pour l'utilisateur.
- ⚠️ Contraire aux conditions d'utilisation de Letterboxd, et fragile (casse quand le site change). C'est ce qui a fait tomber les concurrents.
- → À garder comme **option secondaire**, jamais comme seule porte d'entrée. Le CSV reste la méthode principale.

**Confiance / explications**
- Pour chaque film : « Recommandé parce que tu as aimé *X*, *Y* et *Z* ».
- Un niveau de confiance (fort / moyen / faible) selon la quantité de données.

**Utilité locale**
- Filtre « disponible sur mes abonnements en France » (Netflix, Canal+, Max, Prime, Mubi…) via l'API TMDB.
- Lien avec l'autre idée : **quel abonnement prendre pour voir ma watchlist ?**

---

## 5. Idées qu'on peut rajouter plus tard

- **Calibration** : respecter les proportions de ton profil (genres, décennies, pays) pour ne pas tout ramener au cinéma américain récent.
- **Filtres** : durée, décennie, pays, langue, genre.
- **« Comme ce film »** : partir d'un seul film plutôt que de tout l'historique.
- **Partir d'une liste** : utiliser une liste Letterboxd (ou une watchlist) comme point de départ.
- **Ton profil cinéphile** : un petit « Wrapped » (réalisateurs favoris, pays, décennies, taux de pépites dans ton historique). Bon pour le partage sur les réseaux.
- **Mode à deux** : fusionner deux historiques pour trouver un film qui plaira aux deux (soirée en couple, entre potes).
- **Blocage** : masquer un film recommandé pour qu'il ne revienne plus.
- **Ajout à la watchlist** : lien direct vers la fiche Letterboxd du film.
- **Feedback** : deux boutons texte « ça me tente » / « pas pour moi » sur les recommandations pour mesurer la qualité.
- **Modèle séquentiel** (SASRec) qui tient compte de l'ordre du journal de visionnage.

---

## 6. Contraintes à respecter

| Sujet | Contrainte |
|---|---|
| **MovieLens** | Usage non commercial uniquement sans accord de GroupLens. Citer le dataset. Ne pas laisser croire à un soutien de l'Université du Minnesota. |
| **TMDB** | Gratuit en non commercial. Logo TMDB + mention « This product uses the TMDB API but is not endorsed or certified by TMDB » dans une page « À propos ». Pas de cache de plus de 6 mois. |
| **IMDb datasets** | Non commercial. **Hors ligne uniquement** (jointures, vérification des imdbId, contrôles qualité) : rien de ce qui est embarqué dans le site n'en vient. |
| **Letterboxd** | Ne pas utiliser le nom ou le logo comme marque. Scraping = contraire aux conditions. |
| **Vie privée** | Traitement dans le navigateur, aucun stockage côté serveur → pas de problème RGPD. |
| **Monétisation** | Aucune prévue. Un lien de dons éventuel est une zone grise vis-à-vis des licences : demander aux ayants droit avant. |

---

## 7. Architecture envisagée (première version)

```
[Entraînement, une seule fois, sur PC ou Colab]
MovieLens 32M ──► modèle (EASE / ALS) ──► vecteurs des films (quelques Mo, binaire embeddings.bin)
                                         + popularité de chaque film
                                         + correspondance MovieLens ↔ TMDB ↔ IMDb

[Site statique, hébergé gratuitement : GitHub Pages / Cloudflare Pages]
Fichier utilisateur ──► adaptateur (Letterboxd / IMDb / autre)
                    ──► format interne + notes normalisées
                    ──► correspondance des titres
                    ──► calcul des scores dans le navigateur
                    ──► curseur connu / pépite (re-classement)
                    ──► affichage (affiches via TMDB)
```

**Coût estimé :** 0 € d'hébergement, ~10-15 €/an pour un nom de domaine (optionnel).

---

## 8. Comment on saura que ça marche

- **Hors ligne** : sur MovieLens, cacher une partie des films aimés et vérifier qu'on les retrouve (Recall@20, NDCG@20), en suivant aussi la **nouveauté** (popularité moyenne des films recommandés).
- **Avec de vrais utilisateurs** : 10 à 20 cinéphiles volontaires. Question clé : *« Combien de ces films ne connaissais-tu pas et as-tu envie de voir ? »*

---

## 9. Décisions prises (6 novembre 2026)

| Question | Décision |
|---|---|
| Nom du site | **« Pépite » comme nom de travail**, temporaire. Le nom définitif reste à trouver. |
| Modèle | **ALS** en production. EASE uniquement comme point de comparaison hors ligne. |
| Taille du catalogue | **~20 000 à 25 000 films** (réel : 23 019), seuil bas (**≥ 20 notes** dans MovieLens) pour garder la longue traîne, ajusté pour rester autour de **5 Mo** de données. |
| Films récents (après 2023) | **On accepte le trou pour le MVP** et on le dit honnêtement sur le site. Modèle basé sur le contenu en v2. |
| Licences | **On contacte GroupLens et TMDB directement** pour valider l'usage (voir section 10). |
| Framework | **React** (avec Vite + TypeScript). |
| Direction visuelle | **C · Fanzine** (voir section 3 et `design-system.md`). |
| IA pour les listes faites main | **Pas d'IA au MVP** : correspondance floue des titres (Fuse.js). Plus tard : petit modèle via API derrière un Cloudflare Worker, avec limite d'usage. |

## 10. Actions

- [x] Choisir le framework → React
- [x] Clé API TMDB obtenue (Developer Plan, usage non commercial, type « Website »). **Ne jamais la mettre dans le code** : secrets GitHub uniquement.
- [x] Mail envoyé à GroupLens (grouplens-info@umn.edu) le 6 novembre 2026 → **réponse en attente**. On développe en local en attendant ; la réponse est nécessaire avant la mise en ligne.
- [ ] Trouver le nom définitif et vérifier le nom de domaine (plus tard)

## 11. Questions encore ouvertes

- [ ] Nom définitif du site (plus tard)
- [ ] Réponse de GroupLens
