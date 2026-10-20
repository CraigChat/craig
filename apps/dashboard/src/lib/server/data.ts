import { type Prisma, prisma } from '@craig/db';
import type { DriveOptions } from '@craig/types';

export async function getUserData(userId: string) {
  const [userData, entitlements, patreon, google, microsoft, dropbox, box] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        webapp: true,
        rewardTier: true,
        driveEnabled: true,
        driveService: true,
        driveContainer: true,
        driveFormat: true,
        driveOptions: true,
        patronId: true
      }
    }),
    prisma.entitlement.findMany({
      where: { userId },
      select: {
        source: true,
        tier: true,
        expiresAt: true
      }
    }),
    prisma.patreon.findUnique({ where: { id: userId }, select: { name: true } }),
    prisma.googleDriveUser.findUnique({ where: { id: userId }, select: { id: true } }),
    prisma.microsoftUser.findUnique({ where: { id: userId }, select: { name: true } }),
    prisma.dropboxUser.findUnique({ where: { id: userId }, select: { name: true } }),
    prisma.boxUser.findUnique({ where: { id: userId }, select: { name: true } })
  ]);

  return {
    data: {
      webapp: userData?.webapp ?? false,
      rewardTier: userData?.rewardTier ?? 0,
      driveEnabled: userData?.driveEnabled ?? false,
      driveService: userData?.driveService ?? 'google',
      driveContainer: userData?.driveContainer ?? null,
      driveFormat: userData?.driveFormat ?? null,
      driveOptions: (userData?.driveOptions as DriveOptions | undefined) ?? null
    },
    entitlements,
    connections: {
      patreon: userData?.patronId
        ? {
            id: userData.patronId,
            name: patreon?.name
          }
        : null,
      google: google ? { connected: true, name: null } : null,
      onedrive: microsoft ? { connected: true, name: microsoft.name } : null,
      dropbox: dropbox ? { connected: true, name: dropbox.name } : null,
      box: box ? { connected: true, name: box.name } : null
    }
  };
}

export const DRIVE_SERVICES = ['google', 'onedrive', 'dropbox', 'box'] as const;
export type DriveService = (typeof DRIVE_SERVICES)[number];

async function getConnectedServices(userId: string, db: Prisma.TransactionClient = prisma): Promise<Record<DriveService, boolean>> {
  const [google, onedrive, dropbox, box] = await Promise.all([
    db.googleDriveUser.findUnique({ where: { id: userId }, select: { id: true } }),
    db.microsoftUser.findUnique({ where: { id: userId }, select: { id: true } }),
    db.dropboxUser.findUnique({ where: { id: userId }, select: { id: true } }),
    db.boxUser.findUnique({ where: { id: userId }, select: { id: true } })
  ]);
  return { google: !!google, onedrive: !!onedrive, dropbox: !!dropbox, box: !!box };
}

export async function isServiceConnected(userId: string, service: DriveService) {
  return (await getConnectedServices(userId))[service];
}

/**
 * Removes a cloud provider connection in one transaction. If it was the selected
 * `driveService`, switches to the next connected provider, or disables uploads if none are left.
 * `remove` must not throw on a missing row (use `deleteMany`), since a failed statement aborts the transaction.
 */
export async function disconnectService<T>(userId: string, service: DriveService, remove: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { driveService: true } });
    const result = await remove(tx);

    if (user?.driveService === service) {
      const connected = await getConnectedServices(userId, tx);
      const next = DRIVE_SERVICES.find((s) => s !== service && connected[s]);
      await tx.user.update({
        where: { id: userId },
        data: next ? { driveService: next } : { driveEnabled: false }
      });
    }

    return result;
  });
}
