import { cancel, confirm, intro, isCancel, outro, select, spinner, text } from '@clack/prompts';
import { db } from '@craig/db';

const DEVELOPER_SOURCE = 'developer';

const TIERS = {
  'Greater Weasel': -1,
  'Supporter Tier 1': 10,
  'Supporter Tier 2': 20,
  'Supporter Tier 3': 30,
  'Someone that wants MP3 apparently.': 100
} as const;

async function ensureUserExists(userId: string) {
  return db
    .insertInto('User')
    .values({ id: userId })
    .onConflict((oc) => oc.column('id').doNothing())
    .execute();
}

async function updateUserTier(userId: string) {
  const entitlements = await db
    .selectFrom('Entitlement')
    .select('tier')
    .where('userId', '=', userId)
    .where((eb) => eb.or([eb('expiresAt', 'is', null), eb('expiresAt', '>', new Date())]))
    .execute();

  const maxTier = entitlements.some((entitlement) => entitlement.tier === -1)
    ? -1
    : entitlements.reduce((max, entitlement) => Math.max(max, entitlement.tier), 0);

  await db
    .updateTable('User')
    .set({
      rewardTier: maxTier,
      ...(maxTier === 0 ? { driveEnabled: false } : {})
    })
    .where('id', '=', userId)
    .execute();
}

async function createEntitlement(userId: string, tier: number, note?: string, expiresAt?: Date) {
  await ensureUserExists(userId);

  const entitlement = await db
    .insertInto('Entitlement')
    .values({ userId, source: DEVELOPER_SOURCE, tier, note, expiresAt })
    .onConflict((oc) => oc.columns(['userId', 'source']).doUpdateSet({ tier, note, expiresAt }))
    .returningAll()
    .executeTakeFirstOrThrow();

  await updateUserTier(userId);

  return entitlement;
}

async function revokeEntitlement(userId: string) {
  const result = await db.deleteFrom('Entitlement').where('userId', '=', userId).where('source', '=', DEVELOPER_SOURCE).executeTakeFirst();
  if (!result.numDeletedRows) return;

  await updateUserTier(userId);
}

function exitCancelled(): never {
  cancel('Operation cancelled');
  process.exit(0);
}

async function main() {
  intro('Craig Entitlements Manager');

  const action = await select({
    message: 'What would you like to do?',
    options: [
      { value: 'update', label: 'Update/Create Entitlement' },
      { value: 'revoke', label: 'Revoke Entitlement' }
    ]
  });

  if (isCancel(action)) exitCancelled();

  const userId = await text({
    message: 'Enter the user ID',
    validate: (value) => {
      if (value.length === 0) return 'User ID is required';
    }
  });

  if (isCancel(userId)) exitCancelled();

  if (action === 'revoke') {
    const s = spinner();
    s.start('Revoking entitlement...');
    await revokeEntitlement(userId);
    s.stop('Done.');

    outro('Entitlement revoked successfully');
    return;
  }

  const tier = await select({
    message: 'Select the tier level',
    options: Object.entries(TIERS).map(([label, value]) => ({
      value,
      label: `${label} (${value})`
    }))
  });

  if (isCancel(tier)) exitCancelled();

  const wantsNote = await confirm({
    message: 'Do you want to add a note?'
  });

  if (isCancel(wantsNote)) exitCancelled();

  let note: string | undefined;
  if (wantsNote) {
    const noteResponse = await text({
      message: 'Enter the note'
    });

    if (isCancel(noteResponse)) exitCancelled();

    note = noteResponse;
  }

  const wantsExpiry = await confirm({
    message: 'Do you want to set an expiry time?'
  });

  if (isCancel(wantsExpiry)) exitCancelled();

  let expiryDate: Date | undefined;
  if (wantsExpiry) {
    const days = await text({
      message: 'Enter number of days until expiry',
      validate: (value) => {
        const num = parseInt(value, 10);
        if (Number.isNaN(num) || num <= 0) return 'Please enter a valid positive number';
      }
    });

    if (isCancel(days)) exitCancelled();

    expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + parseInt(days, 10));
  }

  const s = spinner();
  s.start('Pushing entitlement...');
  await createEntitlement(userId, tier, note, expiryDate);
  s.stop('Done.');

  outro('Entitlement updated successfully');
}

main()
  .catch((error: unknown) => {
    console.error('Error:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.destroy();
  });
