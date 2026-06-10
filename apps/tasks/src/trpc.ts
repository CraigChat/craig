import * as trpc from '@trpc/server';
import { createHTTPServer } from '@trpc/server/adapters/standalone';
import { z } from 'zod';

import { driveUpload, driveSummaryUpload, driveTranscriptUpload } from './queries/driveUpload';

const appRouter = trpc
  .router()
  .query('health', {
    resolve: () => ({ ok: true })
  })
  .query('driveUpload', {
    input: z.object({
      recordingId: z.string(),
      userId: z.string()
    }),
    resolve: async ({ input }) => {
      return await driveUpload(input);
    }
  })
  .query('driveSummaryUpload', {
    input: z.object({
      recordingId: z.string(),
      userId: z.string()
    }),
    resolve: async ({ input }) => {
      return await driveSummaryUpload(input);
    }
  })
  .query('driveTranscriptUpload', {
    input: z.object({
      recordingId: z.string(),
      userId: z.string()
    }),
    resolve: async ({ input }) => {
      return await driveTranscriptUpload(input);
    }
  });

const { listen } = createHTTPServer({
  router: appRouter,
  createContext() {
    return {};
  }
});

export { listen };
