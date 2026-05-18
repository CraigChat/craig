import { promises as fs } from 'fs';
import i18next, { TFunction } from 'i18next';
import Backend from 'i18next-fs-backend';
import path from 'path';
import { CommandContext } from 'slash-create';

const localePath = path.resolve(process.cwd(), '../../locale');

export const init = async () => {
  await i18next.use(Backend).init({
    showSupportNotice: false,
    fallbackLng: 'en',
    ns: ['commands'],
    defaultNS: 'commands',
    interpolation: {
      escapeValue: false
    },
    backend: {
      loadPath: path.join(localePath, '{{lng}}/{{ns}}.json')
    }
  });

  const lngs = await fs.readdir(localePath);
  await i18next.loadLanguages(lngs.filter((lng) => !lng.includes('.'))).catch(() => undefined);
};

export function createT(lang: string) {
  return i18next.getFixedT(lang);
}

export function createCtxT(ctx: CommandContext): [TFunction, string] {
  const langMap: { [key: string]: string } = {
    'en-US': 'en',
    'en-GB': 'en'
  };

  if (ctx.locale) {
    const lang = langMap[ctx.locale] ?? ctx.locale;
    if (i18next.getResourceBundle(lang, 'commands')) return [createT(lang), lang];
  }

  if (ctx.guildLocale) {
    const lang = langMap[ctx.guildLocale] ?? ctx.guildLocale;
    if (i18next.getResourceBundle(lang, 'commands')) return [createT(lang), lang];
  }

  return [createT('en'), 'en'];
}

export function formatNumber(number: number, lang: string) {
  try {
    return new Intl.NumberFormat(lang.replace('_', '-')).format(number);
  } catch (e) {
    return number.toLocaleString();
  }
}
