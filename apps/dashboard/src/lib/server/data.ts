import { prisma, type User } from "@craig/db";
import type { DriveOptions } from "@craig/types";

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
    prisma.patreon.findUnique({ where: { id: userId } }),
    prisma.googleDriveUser.findUnique({ where: { id: userId } }),
    prisma.microsoftUser.findUnique({ where: { id: userId } }),
    prisma.dropboxUser.findUnique({ where: { id: userId } }),
    prisma.boxUser.findUnique({ where: { id: userId } })
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
      patreon: userData?.patronId ? {
        id: userData.patronId,
        name: patreon?.name
      } : null,
      google: google ? { connected: true, name: null } : null,
      onedrive: microsoft ? { connected: true, name: microsoft.name } : null,
      dropbox: dropbox ? { connected: true, name: dropbox.name } : null,
      box: box ? { connected: true, name: box.name } : null
    }
  }
}

export async function setNextAvailableService(user: User, exclude: string) {
  const services = ['google', 'onedrive', 'dropbox', 'box'].filter((s) => s !== exclude);

  for (const service of services) {
    let serviceData;
    switch (service) {
      case 'google':
        serviceData = await prisma.googleDriveUser.findUnique({ where: { id: user.id } });
        break;
      case 'onedrive':
        serviceData = await prisma.microsoftUser.findUnique({ where: { id: user.id } });
        break;
      case 'dropbox':
        serviceData = await prisma.dropboxUser.findUnique({ where: { id: user.id } });
        break;
      case 'box':
        serviceData = await prisma.boxUser.findUnique({ where: { id: user.id } });
        break;
    }

    if (serviceData) {
      await prisma.user.update({
        where: { id: user.id },
        data: { driveService: service }
      });
      return;
    }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { driveEnabled: false }
  });
}
