import { TFunction } from 'react-i18next';
import i18n from './i18n';

export interface PlatformInfo {
  windows: boolean;
  macosx: boolean;
  iphone: boolean;
  unix: boolean;
  android: boolean;
  showHidden?: boolean;
}

export const getPlatformInfo = (): PlatformInfo => {
  return {
    windows: navigator.userAgent.toLowerCase().includes('win'),
    macosx: navigator.userAgent.toLowerCase().includes('mac os x'),
    iphone: navigator.userAgent.toLowerCase().includes('iphone'),
    unix: navigator.userAgent.toLowerCase().includes('linux') || navigator.userAgent.toLowerCase().includes('bsd'),
    android: navigator.userAgent.toLowerCase().includes('android')
  };
};

export const parseError = async (error: any, t?: TFunction) => {
  if (!t) t = i18n.t;
  let errorText = error.toString();
  let errorCode = 0;
  if (error instanceof Response) {
    const body = await error.json().catch(() => {});
    if (body && body.error) {
      errorText = body.error;
      if (body.code) errorCode = body.code;
    } else errorText = `${error.status}: ${error.statusText}`;
  }

  return { errorText, errorCode, errorT: errorCode ? t([`error.${errorCode}`, 'error.unknown']) : errorText };
};
