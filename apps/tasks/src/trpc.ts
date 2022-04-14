import * as trpc from '@trpc/server';
import { createHTTPServer } from '@trpc/server/adapters/standalone';
import { z } from 'zod';

import { driveUpload } from './queries/driveUpload';

export const appRouter = trpc.router().query('driveUpload', {
  input: z.object({
    recordingId: z.string(),
    userId: z.string()
  }),
  resolve: async ({ input }) => {
    return await driveUpload(input);
  }
});

export type AppRouter = typeof appRouter;

const { server, listen } = createHTTPServer({
  router: appRouter,
  createContext() {
    return {};
  }
});

export { listen, server };
