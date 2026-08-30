import type { ParamMatcher } from '@sveltejs/kit';

const RECORDING_ID_REGEX = /^[A-Za-z0-9]{10,12}$/;

export const match: ParamMatcher = (param) => {
  return RECORDING_ID_REGEX.test(param);
};
