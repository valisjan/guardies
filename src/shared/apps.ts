// Aplicacions del centre i qui les veu al menú «Apps».
// Còpia idèntica a Quota, Guàrdies, Pantalles i Retards (src/shared/): si es canvia, cal canviar-la a totes.
export const SHARED_APPS_VERSION = 1;

export type AppKey = 'quota' | 'guardies' | 'pantalles' | 'retards';

export interface CentreApp {
  key: AppKey;
  name: string;
  description: string;
  href: string;
}

export interface AppAccess {
  signedIn?: boolean;
  isAdmin?: boolean;
  canRetards?: boolean;
  courseId?: string;
}

const PRODUCTION: Record<AppKey, string> = {
  quota: 'https://quota.iessureda.com/',
  guardies: 'https://guardies.iessureda.com/',
  pantalles: 'https://pantalles.iessureda.com/?gestio=1&pantalla=sala-professorat',
  retards: 'https://retards.iessureda.com/',
};

// Si el filtre de la xarxa bloqueja el domini propi, es treballa des de les adreces de Netlify.
const NETLIFY: Record<AppKey, string> = {
  quota: 'https://chic-tartufo-68ee9c.netlify.app/',
  guardies: 'https://guardies.netlify.app/',
  pantalles: 'https://pantalles.netlify.app/?gestio=1&pantalla=sala-professorat',
  retards: 'https://spontaneous-gecko-a2703a.netlify.app/',
};

// Sense sessió, cap. Pantalles, només l'administració; Retards, l'administració i la PSC.
export function centreApps(access: AppAccess = {}, hostname = typeof window === 'undefined' ? '' : window.location.hostname): CentreApp[] {
  if (!access.signedIn) return [];
  const base = hostname.endsWith('.netlify.app') ? NETLIFY : PRODUCTION;
  const guardies = new URL(base.guardies);
  if (access.courseId) guardies.searchParams.set('curs', access.courseId);
  if (!access.isAdmin) guardies.searchParams.set('vista', 'professor');
  const apps: CentreApp[] = [
    { key: 'quota', name: 'Quota', description: 'Quota i repartiment d’hores', href: base.quota },
    { key: 'guardies', name: 'Guàrdies', description: access.isAdmin ? 'Full de guàrdies del dia' : 'Les teves guàrdies', href: guardies.toString() },
  ];
  if (access.isAdmin) apps.push({ key: 'pantalles', name: 'Pantalles', description: 'Pantalles del centre', href: base.pantalles });
  if (access.isAdmin || access.canRetards) apps.push({ key: 'retards', name: 'Retards', description: 'Retards de l’alumnat', href: base.retards });
  return apps;
}
