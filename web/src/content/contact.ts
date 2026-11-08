/** Contact address, given by Thibault at the end of step 6b (D3, Q6). */
export const CONTACT_EMAIL = 'thibault.rabbe@outlook.fr';

export const CONTACT_SUBJECTS = [
  { id: 'bug', label: 'un bug' },
  { id: 'film', label: 'un film mal reconnu' },
  { id: 'idee', label: 'une idée' },
  { id: 'autre', label: 'autre chose' },
] as const;
export type ContactSubject = (typeof CONTACT_SUBJECTS)[number]['id'];

export const MESSAGE_MAX = 2000;

// Texts: Claude Web (R7).
export const CONTACT = {
  titre: 'contact.',
  intro: [
    "un bug, un film mal reconnu, une idée, ou juste un film que t'as découvert ici : écris-moi.",
    'je lis tout, et je réponds quand je peux.',
  ],
  adresseLabel: "l'adresse",
  copier: 'copier',
  copie: 'copiée.',
  copieEchec: "ça a pas marché. sélectionne l'adresse et copie-la à la main.",
  sujetLegende: "c'est à propos de quoi ?",
  messageLabel: 'ton message',
  aideMessage:
    "pour un film mal reconnu, donne son titre et son année tels qu'ils sont dans ton export, et le film qu'on a cru reconnaître. pas besoin d'envoyer ton fichier.",
  bouton: 'ouvrir ma messagerie',
  pasDeMail:
    "rien ne s'ouvre ? c'est qu'il n'y a pas de messagerie réglée sur cet appareil. copie l'adresse plus haut et écris-moi d'où tu veux.",
  erreurSujet: 'choisis un sujet.',
  erreurMessage: 'écris-moi un petit message.',
};
