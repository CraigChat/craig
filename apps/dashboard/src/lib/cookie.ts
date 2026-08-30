import { parse } from 'cookie-es';

export const localeCookieName = 'craig-dashboard-selected-locale';

export function getAll() {
  return parse(document.cookie);
}

export function get(name: string) {
  return parse(document.cookie)[name];
}
