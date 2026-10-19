import { error } from '@sveltejs/kit';

import { getBotApplicationWithCache } from '$lib/server/data';
import { APIErrorCode, type RecordingResponse } from '$lib/types';
import { recordingApiUrl } from '$lib/util';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, fetch, url }) => {
  const key = url.searchParams.get('key') ?? '';
  const deleteKey = url.searchParams.get('delete') ?? '';
  const id = params.id;

  if (!key) error(400, { error: APIErrorCode.KEY_REQUIRED, message: 'Key required' });

  const recordingResponse = await fetch(recordingApiUrl(id, '', { key }));
  const recordingData = await recordingResponse.json();
  if (recordingResponse.status !== 200) error(recordingResponse.status, recordingData);

  const { recording } = recordingData as RecordingResponse;
  const botApplication = recording.client.id ? await getBotApplicationWithCache(recording.client.id) : null;

  return {
    ...(recordingData as RecordingResponse),
    botApplication,
    key,
    deleteKey
  };
};
