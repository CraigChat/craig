import { db, type DbClient } from '@craig/db';
import type { DriveOptions } from '@craig/types';

export async function getUserData(userId: string) {
  const [userData, entitlements, patreon, google, microsoft, dropbox, box] = await Promise.all([
    db
      .selectFrom('User')
      .select(['webapp', 'rewardTier', 'driveEnabled', 'driveService', 'driveContainer', 'driveFormat', 'driveOptions', 'patronId'])
      .where('id', '=', userId)
      .executeTakeFirst(),
    db.selectFrom('Entitlement').select(['source', 'tier', 'expiresAt']).where('userId', '=', userId).execute(),
    db.selectFrom('Patreon').select('name').where('id', '=', userId).executeTakeFirst(),
    db.selectFrom('GoogleDriveUser').select('id').where('id', '=', userId).executeTakeFirst(),
    db.selectFrom('MicrosoftUser').select('name').where('id', '=', userId).executeTakeFirst(),
    db.selectFrom('DropboxUser').select('name').where('id', '=', userId).executeTakeFirst(),
    db.selectFrom('BoxUser').select('name').where('id', '=', userId).executeTakeFirst()
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

async function getConnectedServices(userId: string, client: DbClient = db): Promise<Record<DriveService, boolean>> {
  const [google, onedrive, dropbox, box] = await Promise.all([
    client.selectFrom('GoogleDriveUser').select('id').where('id', '=', userId).executeTakeFirst(),
    client.selectFrom('MicrosoftUser').select('id').where('id', '=', userId).executeTakeFirst(),
    client.selectFrom('DropboxUser').select('id').where('id', '=', userId).executeTakeFirst(),
    client.selectFrom('BoxUser').select('id').where('id', '=', userId).executeTakeFirst()
  ]);
  return { google: !!google, onedrive: !!onedrive, dropbox: !!dropbox, box: !!box };
}

export async function isServiceConnected(userId: string, service: DriveService) {
  return (await getConnectedServices(userId))[service];
}

export async function disconnectService<T>(userId: string, service: DriveService, remove: (tx: DbClient) => Promise<T>) {
  return db.transaction().execute(async (tx) => {
    const user = await tx.selectFrom('User').select('driveService').where('id', '=', userId).executeTakeFirst();
    const result = await remove(tx);

    if (user?.driveService === service) {
      const connected = await getConnectedServices(userId, tx);
      const next = DRIVE_SERVICES.find((s) => s !== service && connected[s]);
      await tx
        .updateTable('User')
        .set(next ? { driveService: next } : { driveEnabled: false })
        .where('id', '=', userId)
        .execute();
    }

    return result;
  });
}
