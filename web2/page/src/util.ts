/* global WindowEventMap AddEventListenerOptions */
import { useEffect, useRef } from 'preact/hooks';
import { TFunction } from 'react-i18next';
import { CookAvatarsPayload, CookPayload } from './api';
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

export function useWindowEvent<TType extends keyof WindowEventMap>(
  type: TType,
  listener: (this: Window, ev: WindowEventMap[TType]) => any,
  options?: boolean | AddEventListenerOptions
) {
  const listenerRef = useRef(listener);
  listenerRef.current = listener;
  useEffect(
    function () {
      function handler(event) {
        listenerRef.current.call(window, event);
      }

      window.addEventListener(type, handler, options);
      return function () {
        return window.removeEventListener(type, handler, options);
      };
    },
    [type, options]
  );
}

export type StringT = string | ((t: TFunction) => string);

export function asT(t: TFunction, text: string | ((t: TFunction) => string)) {
  if (typeof text === 'function') return text(t);
  return text;
}

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

export const wait = (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

export const cookDownload = (id: string, key: string | number, payload: CookPayload) => {
  location.href = `/api/recording/${id}/cook/run?key=${key}&${new URLSearchParams(
    payload as Record<string, string>
  ).toString()}`;
};

export const cookAvatarDownload = (id: string, key: string | number, payload: CookAvatarsPayload) => {
  location.href = `/api/recording/${id}/cook/avatars/run?key=${key}&${new URLSearchParams(
    payload as Record<string, string>
  ).toString()}`;
};

export const downloadResponse = async (response: Response) => {
  const filename = response.headers.get('content-disposition').slice(21);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  console.log('Opened download link', { blob, filename });
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
