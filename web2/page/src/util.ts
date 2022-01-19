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
