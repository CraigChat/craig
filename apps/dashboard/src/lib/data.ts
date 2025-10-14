import { toast } from 'svelte-sonner';

import { invalidateAll } from '$app/navigation';
import { get, writable } from 'svelte/store';
import { APIErrorCode, type APIErrorResponse } from '$lib/types';
import { t } from 'svelte-i18n';

export const savingSettings = writable(false);

export async function updateSettings(data: any) {
  const _t = get(t);
  savingSettings.set(true);
  try {
    const response = await fetch('/api/user/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).catch(() => null);
    if (!response) return;
    if (!response.ok) {
      const err: APIErrorResponse = await response.json().catch(() => null);
      const responseError = err?.code ?? APIErrorCode.SERVER_ERROR;
      toast.error(`${_t(`cloud_backup.settings_error`)}: ${_t(`errors.${responseError}`)}`);
    } else await invalidateAll();
  } catch (e) {}
  savingSettings.set(false);
}
