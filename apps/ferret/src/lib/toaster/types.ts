import type { Component } from 'svelte';

export type FixMe = unknown;

export type ToastTypes = 'normal' | 'action' | 'success' | 'info' | 'warning' | 'error' | 'loading';

export type PromiseT<Data = unknown> = Promise<Data> | (() => Promise<Data>);

export type PromiseData<ToastData = unknown> = ExternalToast & {
  loading: string | Component;
  success: string | Component | ((data: ToastData) => Component | string);
  info: string | Component | ((data: ToastData) => Component | string);
  warning: string | Component | ((data: ToastData) => Component | string);
  error: string | Component | ((error: unknown) => Component | string);
};

export interface ToastT {
  id: number | string;
  title?: string | Component;
  type?: ToastTypes;
  icon?: Component;
  component?: Component;
  invert?: boolean;
  description?: string | Component;
  duration?: number;
  delete?: boolean;
  important?: boolean;
  action?: {
    label: string;
    onClick: (event: MouseEvent) => void;
  };
  cancel?: {
    label: string;
    onClick?: () => void;
  };
  onDismiss?: (toast: ToastT) => void;
  onAutoClose?: (toast: ToastT) => void;
  promise?: PromiseT;
  style?: string;
  class?: string;
  descriptionClass?: string;
}

export type Position = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'top-center' | 'bottom-center';

export interface HeightT {
  height: number;
  toastId: number | string;
}

export enum SwipeStateTypes {
  SwipedOut = 'SwipedOut',
  SwipedBack = 'SwipedBack',
  NotSwiped = 'NotSwiped'
}

export type Theme = 'light' | 'dark';

export interface ToastToDismiss {
  id: number | string;
  dismiss: boolean;
}

export type ExternalToast = Omit<ToastT, 'id' | 'type' | 'title'> & {
  id?: number | string;
};
