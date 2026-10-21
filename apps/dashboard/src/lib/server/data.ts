import { db, type DbClient } from '@craig/db';
import type { DriveOptions } from '@craig/types';

export async function getUserData(userId: string) {
  const [userData, entitlements, connections] = await Promise.all([
    db
      .selectFrom('User')
      .select(['webapp', 'rewardTier', 'driveEnabled', 'driveService', 'driveContainer', 'driveFormat', 'driveOptions', 'patronId'])
      .select((eb) => eb.selectFrom('Patreon').select('name').whereRef('Patreon.id', '=', 'User.patronId').as('patreonName'))
      .where('id', '=', userId)
      .executeTakeFirst(),
    db.selectFrom('Entitlement').select(['source', 'tier', 'expiresAt']).where('userId', '=', userId).execute(),
    db
      .selectNoFrom((eb) => [
        eb.exists(eb.selectFrom('GoogleDriveUser').where('id', '=', userId)).as('google'),
        eb.selectFrom('MicrosoftUser').select('name').where('id', '=', userId).as('microsoft'),
        eb.selectFrom('DropboxUser').select('name').where('id', '=', userId).as('dropbox'),
        eb.selectFrom('BoxUser').select('name').where('id', '=', userId).as('box')
      ])
      .executeTakeFirstOrThrow()
  ]);
  const { google, microsoft, dropbox, box } = connections;

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
            name: userData.patreonName ?? undefined
          }
        : null,
      google: google ? { connected: true, name: null } : null,
      onedrive: microsoft !== null ? { connected: true, name: microsoft } : null,
      dropbox: dropbox !== null ? { connected: true, name: dropbox } : null,
      box: box !== null ? { connected: true, name: box } : null
    }
  };
}

export const DRIVE_SERVICES = ['google', 'onedrive', 'dropbox', 'box'] as const;
export type DriveService = (typeof DRIVE_SERVICES)[number];

function getConnectedServices(userId: string, client: DbClient = db): Promise<Record<DriveService, boolean>> {
  return client
    .selectNoFrom((eb) => [
      eb.exists(eb.selectFrom('GoogleDriveUser').where('id', '=', userId)).$castTo<boolean>().as('google'),
      eb.exists(eb.selectFrom('MicrosoftUser').where('id', '=', userId)).$castTo<boolean>().as('onedrive'),
      eb.exists(eb.selectFrom('DropboxUser').where('id', '=', userId)).$castTo<boolean>().as('dropbox'),
      eb.exists(eb.selectFrom('BoxUser').where('id', '=', userId)).$castTo<boolean>().as('box')
    ])
    .executeTakeFirstOrThrow();
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
