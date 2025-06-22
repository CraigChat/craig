import type { Kitchen, Recording } from '@craig/types';
import { z } from 'zod';

import { APIErrorCode } from '$lib/types';

type ValidateOptionsResult =
  | {
      valid: true;
      options: Kitchen.CreateJobOptions['options'];
    }
  | {
      valid: false;
      code: APIErrorCode;
      error?: z.ZodFormattedError<PostJobBody>;
    };

export function validateOptions(recording: Recording.RecordingInfo, users: Recording.RecordingUser[], body: any): ValidateOptionsResult {
  const parsed = PostJobBodySchema.safeParse(body);
  if (!parsed.success) return { valid: false, code: APIErrorCode.INVALID_BODY, error: parsed.error.format() };

  switch (parsed.data.type) {
    case 'recording': {
      return parseRecordingOptions(recording, users, parsed.data.options);
    }
    case 'avatars': {
      return parseAvatarsOptions(recording, users, parsed.data.options);
    }
  }

  return { valid: false, code: APIErrorCode.INVALID_BODY };
}

/**
 * Recording Type
 */

const GENERIC_DOWNLOAD_FORMATS = ['flac', 'mp3', 'vorbis', 'aac', 'adpcm', 'wav8', 'opus', 'oggflac', 'heaac'] as const;
const EXTRACTOR_DOWNLOAD_FORMATS = [
  'powersfx', // Windows
  'powersfxm', // Mac
  'powersfxu' // Unix
] as const;

const ALLOWED_RECORDING_FORMATS = [...GENERIC_DOWNLOAD_FORMATS, ...EXTRACTOR_DOWNLOAD_FORMATS] as const;
const ALLOWED_RECORDING_CONTAINERS = ['zip', 'aupzip', 'sesxzip', 'mix', 'exe'] as const;
const ALLOWED_RECORDING_MIX_FORMATS = ['flac', 'vorbis', 'aac', 'mp3'];

const PostJobRecordingSchema = z.object({
  type: z.literal('recording'),
  options: z.object({
    container: z.enum(ALLOWED_RECORDING_CONTAINERS).optional().default('zip'),
    format: z.enum(ALLOWED_RECORDING_FORMATS).optional(),
    dynaudnorm: z.boolean().optional(),
    ignoreTracks: z
      .array(z.number().finite())
      .refine((arr) => arr.length === new Set(arr).size, 'Array elements must be unique')
      .optional(),
    skipDynaudnorm: z
      .array(z.number().finite())
      .refine((arr) => arr.length === new Set(arr).size, 'Array elements must be unique')
      .optional()
  })
});

export function parseRecordingOptions(
  recording: Recording.RecordingInfo,
  users: Recording.RecordingUser[],
  options: z.infer<typeof PostJobRecordingSchema>['options']
): ValidateOptionsResult {
  const data: Kitchen.CreateJobOptions['options'] = {};
  const trackNumbers = users.map((u) => u.track);

  // Check features
  if (options.container === 'mix' && !recording.features.mix) return { valid: false, code: APIErrorCode.FEATURE_UNAVAILABLE };
  if (options.format === 'mp3' && !recording.features.mp3) return { valid: false, code: APIErrorCode.FEATURE_UNAVAILABLE };

  // Ignore tracks
  if (options.ignoreTracks) {
    if (options.ignoreTracks.some((t) => !trackNumbers.includes(t))) return { valid: false, code: APIErrorCode.INVALID_TRACK };
    if (options.ignoreTracks.length === users.length) return { valid: false, code: APIErrorCode.NO_TRACKS_GIVEN };
    data.ignoreTracks = options.ignoreTracks;
  }

  // Skip dynaudnorm
  if (options.skipDynaudnorm) {
    if (options.skipDynaudnorm.some((t) => !trackNumbers.includes(t))) return { valid: false, code: APIErrorCode.INVALID_TRACK };
  }

  // Self-extractors (powersfx will have exe container after parsing, else zip container)
  if (EXTRACTOR_DOWNLOAD_FORMATS.includes(options.format as any)) {
    data.format = options.format;
    if (options.format === 'powersfx') data.container = 'exe';
    return { valid: true, options: data };
  }

  // Audacity Project / Adobe Audition Session Project
  if (options.container === 'aupzip' || options.container === 'sesxzip') {
    data.container = options.container;
    data.dynaudnorm = options.dynaudnorm;
    data.skipDynaudnorm = options.skipDynaudnorm;
    return { valid: true, options: data };
  }

  // Single Track Mixed
  if (options.container === 'mix') {
    data.container = options.container;
    if (ALLOWED_RECORDING_MIX_FORMATS.includes(options.format as any)) {
      data.format = options.format;
      return { valid: true, options: data };
    } else return { valid: false, code: APIErrorCode.INVALID_FORMAT };
  }

  // ZIP container
  if (options.container === 'zip') {
    data.container = options.container;
    if (GENERIC_DOWNLOAD_FORMATS.includes(options.format as any)) {
      data.format = options.format;
      data.dynaudnorm = options.dynaudnorm;
      data.skipDynaudnorm = options.skipDynaudnorm;
      return { valid: true, options: data };
    } else return { valid: false, code: APIErrorCode.INVALID_FORMAT };
  }

  return { valid: false, code: APIErrorCode.INVALID_BODY };
}

/**
 * Avatars Type
 */

const ALLOWED_AVATARS_FORMATS = ['mkvh264', 'webmvp8'] as const;
const ALLOWED_AVATARS_CONTAINERS = ['zip'] as const;

const PostJobAvatarsSchema = z.object({
  type: z.literal('avatars'),
  options: z.object({
    format: z.enum(ALLOWED_AVATARS_FORMATS).optional(),
    container: z.enum(ALLOWED_AVATARS_CONTAINERS).optional(),
    bg: z
      .string()
      .regex(/^[0-9a-f]{6}$/)
      .optional(),
    fg: z
      .string()
      .regex(/^[0-9a-f]{6}$/)
      .optional(),
    transparent: z.boolean().optional(),
    ignoreTracks: z
      .array(z.number().finite())
      .refine((arr) => arr.length === new Set(arr).size, 'Array elements must be unique')
      .optional()
  })
});

export function parseAvatarsOptions(
  recording: Recording.RecordingInfo,
  users: Recording.RecordingUser[],
  options: z.infer<typeof PostJobAvatarsSchema>['options']
): ValidateOptionsResult {
  const data: Kitchen.CreateJobOptions['options'] = {};

  // Check features
  if (!recording.features.glowers) return { valid: false, code: APIErrorCode.FEATURE_UNAVAILABLE };

  // Ignore tracks
  if (options.ignoreTracks) {
    const trackNumbers = users.map((u) => u.track);
    if (options.ignoreTracks.some((t) => !trackNumbers.includes(t))) return { valid: false, code: APIErrorCode.INVALID_FORMAT };
    if (options.ignoreTracks.length === users.length) return { valid: false, code: APIErrorCode.NO_TRACKS_GIVEN };
  }

  // zod does enough validation, we passthru options here
  data.format = options.format as any;
  data.bg = options.bg;
  data.fg = options.fg;
  data.transparent = options.transparent;

  return { valid: true, options: data };
}

/**
 * Overall schema definition
 */

const PostJobBodySchema = z.discriminatedUnion('type', [PostJobRecordingSchema, PostJobAvatarsSchema]);
export type PostJobBody = z.infer<typeof PostJobBodySchema>;
