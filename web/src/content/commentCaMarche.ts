import { pending } from './pending';

// « comment ça marche », detailed (D2). One entry per section, paragraphs in order.
export const COMMENT_CA_MARCHE = {
  titre: 'comment ça marche.',
  modele: { titre: 'le principe', paragraphes: [pending('ccm.modele')] },
  percentiles: { titre: 'tes notes', paragraphes: [pending('ccm.percentiles')] },
  curseur: { titre: 'le curseur', paragraphes: [pending('ccm.curseur')] },
  donnees: { titre: "d'où viennent les données", paragraphes: [pending('ccm.donnees')] },
  onGardeRien: { titre: 'on garde rien', liste: [pending('ccm.onGardeRien')] },
  limites: { titre: "ce qu'on sait pas faire", liste: [pending('ccm.limites')] },
  inspirations: { titre: 'inspirations', paragraphes: [pending('ccm.inspirations')] },
};
