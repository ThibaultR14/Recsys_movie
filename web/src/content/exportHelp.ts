// Export help carousel (D4): 3 steps for Letterboxd, 4 for IMDb. Texts: Claude Web (R7); menu
// names checked by Thibault. `{en:…}` = the site's real English label (rendered with lang="en").
export const EXPORT_HELP = {
  titre: 'où trouver ton export',
  precedent: '← précédent',
  suivant: 'suivant →',
  letterboxd: {
    onglet: 'letterboxd',
    etapes: [
      "sur letterboxd.com (c'est plus simple depuis un ordi), passe sur ton nom en haut de la page et ouvre « {en:settings} ».",
      "va dans l'onglet « {en:data} », puis clique sur « {en:export your data} ».",
      "tu reçois un .zip. pas besoin de l'ouvrir : glisse-le tel quel ici.",
    ],
  },
  imdb: {
    onglet: 'imdb',
    etapes: [
      'sur imdb, ouvre ton profil, puis tes « évaluations ».',
      'en haut de la liste : « actions » → « exporter ».',
      'imdb prépare le fichier sur une page à part. attends quelques minutes, puis recharge la page.',
      'télécharge le .csv et glisse-le ici.',
    ],
  },
};
