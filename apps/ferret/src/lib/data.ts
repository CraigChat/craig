import { persisted } from 'svelte-persisted-store';

export const jobNotify = persisted('craig-notify', false);
export const ennuizelWarned = persisted('craig-ennuizelwarned', false);
