import { error } from '@sveltejs/kit';

import { APIErrorCode, type RecordingResponse } from '$lib/types';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, fetch, url }) => {
  const key = url.searchParams.get('key') ?? '';
  const deleteKey = url.searchParams.get('delete') ?? '';
  const id = params.id;

  if (!key) error(400, { error: APIErrorCode.KEY_REQUIRED, message: 'Key required' });

  const recordingResponse = await fetch(`/api/v1/recordings/${id}?key=${key}`);
  const recordingData = await recordingResponse.json();
  if (recordingResponse.status !== 200) error(recordingResponse.status, recordingData);

  return {
    ...(recordingData as RecordingResponse),
    key,
    deleteKey
  };
};
