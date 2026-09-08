import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import i18next from 'i18next';
import Backend from 'i18next-fs-backend';
import { IntlMessageFormat, PrimitiveType } from 'intl-messageformat';
import { CommandContext, ComponentContext, ModalInteractionContext } from 'slash-create';

export type TFunction = ReturnType<typeof createT>;

const defaultLocalePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../locale');
const discordLocales = [
  'ar',
  'bg',
  'zh-CN',
  'zh-TW',
  'hr',
  'cs',
  'da',
  'nl',
  'fi',
  'fr',
  'de',
  'el',
  'hi',
  'hu',
  'id',
  'it',
  'ja',
  'ko',
  'lt',
  'no',
  'pl',
  'pt-BR',
  'ro',
  'ru',
  'es-ES',
  'es-419',
  'sv-SE',
  'th',
  'tr',
  'uk',
  'vi'
] as const;

let initPromise: Promise<void> | undefined;

export const init = (localePath = process.env.BOT_LOCALE_FOLDER || defaultLocalePath) => {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    await i18next.use(Backend).init({
      showSupportNotice: false,
      fallbackLng: 'en',
      ns: ['bot'],
      defaultNS: 'bot',
      interpolation: {
        escapeValue: false
      },
      backend: {
        loadPath: path.join(localePath, '{{lng}}/{{ns}}.json')
      }
    });

    const lngs = await fs.readdir(localePath);
    await i18next.loadLanguages(lngs.filter((lng) => !lng.includes('.'))).catch(() => undefined);
  })();

  return initPromise;
};

export function getDiscordLocalizations(key: string) {
  const localizations: Record<string, string> = {};

  for (const locale of discordLocales) {
    const language = locale === 'es-ES' ? 'es' : locale;
    const value = i18next.getResource(language, 'bot', key);
    if (typeof value === 'string') localizations[locale] = value;
  }

  return Object.keys(localizations).length ? localizations : undefined;
}

export function createT(lang: string) {
  const t = i18next.getFixedT(lang);
  const formats = new Map<string, IntlMessageFormat>();

  return (key: string, values?: Record<string, PrimitiveType>) => {
    const message = t(key);
    let format = formats.get(message);
    if (!format) {
      format = new IntlMessageFormat(message, lang.replace('_', '-'));
      formats.set(message, format);
    }

    const output = format.format(values);
    return Array.isArray(output) ? output.join('') : String(output);
  };
}

export function createCtxT(ctx: CommandContext | ComponentContext | ModalInteractionContext): [ReturnType<typeof createT>, string] {
  const langMap: { [key: string]: string } = {
    'en-US': 'en',
    'en-GB': 'en',
    'es-ES': 'es'
  };

  if (ctx.locale) {
    const lang = langMap[ctx.locale] ?? ctx.locale;
    if (i18next.getResourceBundle(lang, 'bot')) return [createT(lang), lang];
  }

  if (ctx.guildLocale) {
    const lang = langMap[ctx.guildLocale] ?? ctx.guildLocale;
    if (i18next.getResourceBundle(lang, 'bot')) return [createT(lang), lang];
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
