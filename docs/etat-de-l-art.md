# État de l'art — recommandation de films pour utilisateurs Letterboxd

> Synthèse au 6 novembre 2026 (version complète avec carte des positionnements et sources : document « État de l'art » dans Claude).

## 1. Verdict

Le besoin est réel mais le terrain n'est pas vide : une dizaine d'outils tiers recommandent déjà des films à partir d'un profil Letterboxd. Le projet reste pertinent pour un site gratuit et un portfolio **à condition de viser un angle précis** :

> **« Le Criticker moderne » : gratuit, sans compte, privé, orienté découverte (curseur connu ↔ pépite), explicable, et plus tard avec la disponibilité en France.**

## 2. Letterboxd

- **Aucune recommandation personnalisée**, même dans les offres payantes Pro (~19 $/an) et Patron (~49 $/an) : stats, filtres par plateforme via JustWatch, personnalisation visuelle.
- **API fermée** aux projets de recommandation, d'analyse, de visualisation, aux usages LLM, aux projets personnels et à tout ce qui recrée une fonction présente **ou prévue** de leurs offres payantes. → Risque : Letterboxd pourrait lancer sa propre reco un jour.
- **Autorisé** : l'export de ses propres données (ZIP de CSV) et les flux RSS de profil.

## 3. Concurrents directs (outils sur Letterboxd)

| Outil | Format | Méthode | Faiblesse |
|---|---|---|---|
| Letterboxd Recommendations (Sam Learner) | Site | Scraping + SVD sur ~4 000 utilisateurs actifs, filtre de popularité | **Hors ligne** ; scraping ; aveugle au contenu |
| Lekkerboxd | Extension Chrome | TMDB + signaux Reddit / Taste.io | ~210 utilisateurs |
| Cinema DNA | Site | Export CSV dans le navigateur, statistiques | Surtout un « Wrapped », reco basique |
| Slate | App iOS | Import Letterboxd, swipe | Mobile seulement, opaque |
| Faro | App iOS (bêta) | Import CSV, explications | En bêta |
| Letterboxd Recommender (SASRec) | Code GitHub | SASRec sur MovieLens 32M, ONNX dans le navigateur | À installer soi-même |
| Loverboxd, npogeant, etc. | GitHub | CF classique ou contenu sur films populaires | Pas de site ou que du populaire |

**Tendance 2025-2026** : export CSV traité dans le navigateur plutôt que scraping. Ce n'est donc **plus un différenciateur**, c'est la norme.

## 4. Concurrents indirects

| Service | Approche | À retenir |
|---|---|---|
| **Criticker** (depuis 2005) | Voisins aux goûts similaires (TCI), note prédite (PSI), **percentiles par utilisateur**, importe Letterboxd | Le vrai concurrent sérieux. Interface datée, pas de lien avec la France |
| Taste.io | Correspondance entre utilisateurs, swipe | « Match % » très lisible |
| MovieLens | Site académique | Demande beaucoup de notes |
| TasteRay, I Like Movies | LLM, humeur, streaming local | Démarrage rapide, peu personnel |
| TasteDive, Movik, What2Watch | « Similaire à », humeur | Peu personnel |
| Mubi | Curation humaine | La curation reste forte pour ce public |
| IMDb « Top Picks » | CF sur notes + watchlist | Grand public, recommande surtout des blockbusters |

⚠️ Beaucoup de comparatifs « meilleures apps 2026 » sont écrits par les éditeurs eux-mêmes.

## 5. Le trou de marché

Sur une carte « personnalisation × orientation cinéphile », le coin **cinéphile + vraiment personnalisé** est presque vide : Criticker (daté) et Sam Learner (hors ligne).

Différenciateurs à viser :
1. **Fiabilité** : export CSV + site statique, rien qui casse.
2. **Découverte** : curseur connu ↔ pépite (contre le biais de popularité), calibration plus tard.
3. **Confiance** : « recommandé parce que tu as aimé X et Y ».
4. **Utilité locale** (plus tard) : dispo sur les plateformes françaises.

## 6. Recherche utile (références classiques, à vérifier avant citation formelle)

| Problème | Référence | Application |
|---|---|---|
| Biais de popularité | Abdollahpouri et al. (2017-2019) | Le curseur pépite |
| Calibration | Steck, *Calibrated Recommendations* (RecSys 2018) | Respecter les proportions du profil |
| Nouveauté / diversité / sérendipité | Kaminskas & Bridge (2016) | Métriques en plus de la précision |
| Perception des objectifs | *How Do Users Perceive Recommender Systems' Objectives?* (RecSys 2025) | Étude utilisateurs |
| Modèles | ALS ; EASE (Steck 2019) ; SASRec (Kang & McAuley 2018) | ALS retenu |
| Explications | Tintarev & Masthoff | Le bloc « pourquoi ce film » |
| Échelles de notes | Criticker (percentiles) | Normalisation |
| Dataset | Harper & Konstan, *The MovieLens Datasets* (2015) | Citation obligatoire |

## 7. Données et licences (résumé)

| Source | Licence |
|---|---|
| Export Letterboxd / IMDb de l'utilisateur | Données de l'utilisateur |
| MovieLens 32M | Non commercial ; citer ; pas de soutien implicite de l'université → **mail envoyé à GroupLens, réponse en attente** |
| TMDB API | Non commercial gratuit, attribution, cache ≤ 6 mois → **clé obtenue** |
| IMDb Non-Commercial Datasets | Usage personnel et non commercial → **hors ligne uniquement** (jointures, vérification des imdbId, contrôles qualité), jamais embarqué dans le site |
| Datasets Letterboxd scrapés (HF, Kaggle) | CC-BY-NC-SA / scrapé → **évaluation uniquement**, jamais dans le site |
