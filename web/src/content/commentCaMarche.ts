// « comment ça marche », detailed (D2). One entry per paragraph or list item. Texts: Claude Web
// (R7). `{en:…}` marks English words (rendered with lang="en", see RichText).
export const COMMENT_CA_MARCHE = {
  titre: 'comment ça marche.',
  modele: {
    titre: 'le principe',
    paragraphes: [
      'on ne regarde ni les genres, ni les acteurs, ni les résumés. on regarde qui a aimé quoi.',
      "le modèle a appris sur les notes de 200 000 cinéphiles. à force, il a rangé chaque film sur une sorte de carte des goûts : deux films sont proches quand ce sont les mêmes gens qui les aiment, même s'ils n'ont rien à voir sur le papier.",
      "quand tu déposes ton export, ton navigateur te place sur cette carte à partir de tes films et de tes notes, puis cherche les films proches de toi que t'as pas encore vus. ça prend quelques millisecondes, sur ta machine.",
      "ça s'appelle du filtrage collaboratif (ici, une méthode qui s'appelle ALS). sous chaque carte, « parce que t'as aimé… » cite les films de ton historique les plus proches du film proposé.",
    ],
  },
  percentiles: {
    titre: 'tes notes',
    paragraphes: [
      "un 3★ ne veut pas dire la même chose pour tout le monde : chez certains c'est une bonne note, chez d'autres une déception.",
      'alors on ne lit pas tes notes telles quelles. on regarde où chaque film se place parmi tous les tiens : ton 3★ est bon si tu mets surtout des 2★, et moyen si tu mets surtout des 4★. un film vu sans note compte quand même, à mi-chemin.',
      "c'est pour ça que les notes sur 5 de letterboxd et les notes sur 10 d'imdb marchent pareil.",
    ],
  },
  curseur: {
    titre: 'le curseur',
    paragraphes: [
      "sans rien faire, un modèle de reco propose surtout les films que tout le monde a vus : ils sont proches de beaucoup de gens. c'est ce qu'on appelle le biais de popularité.",
      "le curseur pose un plafond. à chaque cran, on ne garde que les films vus moins d'un certain nombre de fois (20 000, 10 000… jusqu'à 200), toujours classés selon tes goûts. tout à gauche, pas de plafond.",
      'pour savoir combien de gens ont vu un film, on combine les notes MovieLens et les votes TMDB, parce que MovieLens sous-compte les films récents.',
      "le tampon « ✱ pépite » signale le film le moins connu d'une rangée, quand il l'est nettement plus que les autres.",
    ],
  },
  donnees: {
    titre: "d'où viennent les données",
    paragraphes: [
      'les goûts viennent de MovieLens, un jeu de données publié pour la recherche par GroupLens (université du minnesota) : environ 32 millions de notes. on garde les 23 019 films notés au moins 20 fois.',
      'les titres, les réalisateurs et les affiches viennent de TMDB, une base de films collaborative.',
      "la note sous chaque carte, c'est la moyenne MovieLens sur 5, avec le nombre de notes.",
      "les données d'imdb servent seulement à vérifier les correspondances entre films, avant de construire le site. rien d'imdb n'est dans le site.",
    ],
  },
  onGardeRien: {
    titre: 'on garde rien',
    liste: [
      'pas de compte, pas de cookie, pas de base de données',
      "ton fichier est lu par ton navigateur, sur ta machine : il n'est envoyé nulle part, et tout disparaît quand tu fermes la page",
      "une seule exception : si tu passes en thème clair, ton navigateur s'en souvient. rien d'autre",
      "les affiches viennent de tmdb : leurs serveurs voient passer les affiches affichées, rien d'autre",
      'le formulaire de contact ouvre ta messagerie : ton message part de chez toi, pas de chez nous',
    ],
  },
  limites: {
    titre: "ce qu'on sait pas faire",
    liste: [
      "les films sortis après 2023 : nos données s'arrêtent là",
      'les séries',
      'les films très peu vus (moins de 20 notes dans nos données)',
      "les titres qu'on reconnaît mal : on te les montre dans « à vérifier », à toi de trancher",
      'le modèle ne connaît que les goûts des gens qui ont noté sur MovieLens : si tes goûts sont rares chez eux, il aura plus de mal',
    ],
  },
  inspirations: {
    titre: 'inspirations',
    paragraphes: [
      "{en:letterboxd recommendations}, de sam learner : le premier site à faire des recos à partir d'un profil letterboxd. il est souvent hors ligne, et c'est un peu pour ça que ce site existe.",
      "criticker, qui compare les goûts en percentiles depuis 2005 : c'est de là que vient l'idée pour tes notes.",
      'les travaux de recherche sur le biais de popularité et sur la nouveauté des recommandations, qui ont donné le curseur.',
      'et tous les gens qui notent leurs films, sans qui rien de tout ça ne marcherait.',
    ],
  },
};
