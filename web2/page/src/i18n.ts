import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from '../../locale/en/download.json';
import es from '../../locale/es/download.json';
import de from '../../locale/de/download.json';
const resources = {
  de: { download: de },
  en: { download: en },
  es: { download: es }
};

export interface Language {
  value: string;
  title: string;
  icon: IconifyIcon;
}

import { IconifyIcon } from '@iconify/react';
import enFlag from '@iconify-icons/twemoji/flag-for-united-states';
import esFlag from '@iconify-icons/twemoji/flag-for-spain';
import deFlag from '@iconify-icons/twemoji/flag-for-germany';
export const languages: Language[] = [
  {
    value: 'de',
    title: 'Deutsch',
    icon: deFlag
  },
  { value: 'en', title: 'English', icon: enFlag },
  {
    value: 'es',
    title: 'Español',
    icon: esFlag
  }
];

function detectLang() {
  const storedLng = localStorage.getItem('i18nextLng');
  if (storedLng && storedLng in resources) return storedLng;
  if (navigator.language in resources) return navigator.language;
  if (navigator.languages && navigator.languages.length) {
    const foundLang = navigator.languages.find((lang) => lang in resources);
    if (foundLang) return foundLang;
  }
  return 'en';
}

i18n.use(initReactI18next).init({
  resources,
  lng: detectLang(),
  fallbackLng: 'en',
  ns: ['download'],
  defaultNS: 'download',
  interpolation: { escapeValue: false }
});

export default i18n;
