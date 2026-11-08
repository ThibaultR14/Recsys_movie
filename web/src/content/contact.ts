import { pending } from './pending';

/** Contact address, decided by Thibault in R8 (D3, Q6). */
export const CONTACT_EMAIL = '[ADRESSE À CONFIRMER]';

export const CONTACT_SUBJECTS = [
  { id: 'bug', label: 'bug' },
  { id: 'film', label: 'film mal reconnu' },
  { id: 'idee', label: 'idée' },
  { id: 'autre', label: 'autre' },
] as const;
export type ContactSubject = (typeof CONTACT_SUBJECTS)[number]['id'];

export const MESSAGE_MAX = 2000;

export const CONTACT = {
  titre: 'contact.',
  intro: [pending('contact.intro')],
  adresseLabel: "l'adresse",
  copier: 'copier',
  copie: pending('contact.copie'),
  copieEchec: pending('contact.copieEchec'),
  sujetLegende: "c'est à propos de quoi ?",
  messageLabel: 'ton message',
  aideMessage: pending('contact.aideMessage'),
  bouton: pending('contact.bouton'),
  pasDeMail: pending('contact.pasDeMail'),
  erreurSujet: 'choisis un sujet.',
  erreurMessage: 'écris-nous un message.',
};
