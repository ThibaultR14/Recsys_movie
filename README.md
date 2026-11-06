# Pépite (nom de travail)

Site gratuit de recommandation de films pour cinéphiles : tu déposes ton export Letterboxd ou IMDb, et le site te propose des films que tu n'as pas vus, du grand classique à la pépite oubliée. Tout le calcul se fait dans ton navigateur : tes données ne le quittent jamais.

Projet étudiant (M2, ECE Paris), non commercial.

## Structure

```
pipeline/            # Python, hors ligne : MovieLens + TMDB → modèle ALS → fichiers statiques
  notebooks/         # explorations
  tests/
  data/raw/          # données brutes (non versionnées)
  data/processed/    # données intermédiaires (non versionnées)
  data/cache/        # cache des appels TMDB (non versionné)
web/                 # site statique React + Vite + TypeScript
  src/adapters/      # un adaptateur par source d'import (Letterboxd, IMDb…)
  src/matching/      # correspondance des titres
  src/reco/          # fold-in ALS, scores, curseur (Web Worker)
  src/components/    # composants React
  src/pages/         # écrans
  src/styles/        # tokens de la direction visuelle
  public/data/       # fichiers produits par le pipeline (non versionnés pour l'instant)
.github/workflows/   # mise à jour mensuelle des métadonnées TMDB
docs/                # vision, stack, design system, maquette, état de l'art
```

## Configuration

Copie `.env.example` en `.env` et renseigne ta clé TMDB. Le fichier `.env` est ignoré par git.

## Documentation

Voir [`docs/`](docs/), en particulier [`docs/projet-reco-films.md`](docs/projet-reco-films.md) et [`docs/stack-technique.md`](docs/stack-technique.md).

---

Compatible avec les exports Letterboxd et IMDb. Ce projet n'est affilié ni à Letterboxd, ni à IMDb, ni à TMDB.
