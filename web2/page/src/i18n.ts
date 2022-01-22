import i18n from 'i18next';
import detector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import en from '../../locale/en/download.json';
const resources = {
  en: { download: en }
};

export interface Language {
  code: string;
  title: string;
  icon: IconifyIcon;
}

import { IconifyIcon } from '@iconify/react';
import enFlag from '@iconify-icons/twemoji/flag-for-united-states';
export const languages: Language[] = [{ code: 'en', title: 'English', icon: enFlag }];

i18n
  .use(detector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    ns: ['download'],
    defaultNS: 'download',
    interpolation: { escapeValue: false }
  });

export default i18n;
