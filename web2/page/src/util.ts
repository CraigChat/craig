import { TFunction } from 'react-i18next';
import streamSaver from 'streamsaver';
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

export const downloadResponse = async (response: Response) => {
  const filename = response.headers.get('content-disposition').slice(21);
  const fileStream = streamSaver.createWriteStream(filename);

  if (window.WritableStream && response.body.pipeTo) return response.body.pipeTo(fileStream);

  const writer = fileStream.getWriter();
  const reader = response.body.getReader();

  let done = false;
  // deepscan-disable CONSTANT_CONDITION
  while (!done) {
    const res = await reader.read();
    if (res.done) {
      done = true;
      return;
    }
    await writer.write(res.value);
  }
};

export const downloadResponseBlob = async (response: Response) => {
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
