import type { CreateJobOptions, JobType } from '@craig/types/kitchen';
import { get, writable } from 'svelte/store';

import type { APIErrorResponse, MinimalJobInfo, MinimalRecordingInfo, RecordingPageEmitter } from '$lib/types';
import { APIErrorCode } from '$lib/types';

export const jobOpen = writable(false);
export const jobPosting = writable(false);
export const jobPostError = writable<APIErrorCode | null>(null);

export async function postJob(
  emitter: RecordingPageEmitter,
  closeCallback: (() => void) | undefined,
  recording: MinimalRecordingInfo,
  key: string,
  payload: {
    type: JobType;
    options: CreateJobOptions['options'];
  }
) {
  if (get(jobOpen)) return;
  jobPosting.set(true);
  jobPostError.set(null);
  try {
    const response = await fetch(`/api/v1/recordings/${recording.id}/job?key=${key}`, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' }
    }).catch(() => null);
    if (!response) return;
    if (!response.ok) {
      const err: APIErrorResponse = await response.json().catch(() => null);
      jobPostError.set(err?.code ?? APIErrorCode.UNKNOWN_ERROR);
    } else {
      const jobResponse: { job: MinimalJobInfo } = await response.json().catch(() => null);
      if (!jobResponse?.job) return;
      emitter.emit('streamJob', jobResponse.job);
      closeCallback?.();
    }
  } catch (e) {}
  jobPosting.set(false);
}
