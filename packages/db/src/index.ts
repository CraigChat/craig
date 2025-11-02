import { PrismaClient } from '../.prisma-client/client.js';

export const prisma = new PrismaClient();

export * from '../.prisma-client/client.js';
export * from '../.prisma-client/models.js';
