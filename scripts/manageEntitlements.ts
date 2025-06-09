import { cancel, confirm, intro, isCancel, outro, select, spinner, text } from '@clack/prompts';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function ensureUserExists(userId: string) {
  const user = await prisma.user.upsert({
    where: { id: userId },
    update: {},
    create: { id: userId }
  });
  return user;
}

async function updateUserTier(userId: string) {
  const allEntitlements = await prisma.entitlement.findMany({
    where: {
      userId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
    }
  });

  const maxTier = allEntitlements.some((e) => e.tier === -1) ? -1 : allEntitlements.reduce((max, e) => Math.max(max, e.tier), 0);

  await prisma.user.update({
    where: { id: userId },
    data: {
      rewardTier: maxTier,
      ...(maxTier === 0 ? { driveEnabled: false } : {})
    }
  });
}

async function createEntitlement(userId: string, tier: number, note?: string, expiresAt?: Date) {
  await ensureUserExists(userId);
  const entitlement = await prisma.entitlement.upsert({
    where: {
      userId_source: {
        userId,
        source: 'developer'
      }
    },
    update: {
      tier,
      note,
      expiresAt
    },
    create: {
      userId,
      source: 'developer',
      tier,
      note,
      expiresAt
    }
  });

  await updateUserTier(userId);

  return entitlement;
}

async function revokeEntitlement(userId: string) {
  const exists = await prisma.entitlement.findUnique({
    where: {
      userId_source: {
        userId,
        source: 'developer'
      }
    }
  });

  if (exists) {
    await prisma.entitlement.delete({
      where: {
        userId_source: {
          userId,
          source: 'developer'
        }
      }
    });

    await updateUserTier(userId);
  }
}

const TIERS = {
  'Greater Weasel': -1,
  'Supporter Tier 1': 10,
  'Supporter Tier 2': 20,
  'Supporter Tier 3': 30,
  'Someone that wants MP3 apparently.': 100
};

async function main() {
  intro('Craig Entitlements Manager');

  const action = await select({
    message: 'What would you like to do?',
    options: [
      { value: 'update', label: 'Update/Create Entitlement' },
      { value: 'revoke', label: 'Revoke Entitlement' }
    ]
  });

  if (isCancel(action)) {
    cancel('Operation cancelled');
    process.exit(0);
  }

  const userId = await text({
    message: 'Enter the user ID',
    validate: (value) => {
      if (value.length === 0) return 'User ID is required';
    }
  });

  if (isCancel(userId)) {
    cancel('Operation cancelled');
    process.exit(0);
  }

  if (action === 'revoke') {
    const s = spinner();
    s.start('Revoking entitlement...');
    await revokeEntitlement(userId);
    s.stop('Done.');

    outro('Entitlement revoked successfully');
    process.exit(0);
  }

  const tier = await select({
    message: 'Select the tier level',
    options: Object.keys(TIERS).map((label) => ({
      value: TIERS[label as keyof typeof TIERS],
      label: `${label} (${TIERS[label as keyof typeof TIERS]})`
    }))
  });

  if (isCancel(tier)) {
    cancel('Operation cancelled');
    process.exit(0);
  }

  const wantsNote = await confirm({
    message: 'Do you want to add a note?'
  });

  if (isCancel(wantsNote)) {
    cancel('Operation cancelled');
    process.exit(0);
  }

  let note: string | undefined;
  if (wantsNote) {
    const noteResponse = await text({
      message: 'Enter the note'
    });

    if (isCancel(noteResponse)) {
      cancel('Operation cancelled');
      process.exit(0);
    }

    note = noteResponse as string;
  }

  const wantsExpiry = await confirm({
    message: 'Do you want to set an expiry time?'
  });

  if (isCancel(wantsExpiry)) {
    cancel('Operation cancelled');
    process.exit(0);
  }

  let expiryDate: Date | undefined;
  if (wantsExpiry) {
    const days = await text({
      message: 'Enter number of days until expiry',
      validate: (value) => {
        const num = parseInt(value);
        if (isNaN(num) || num <= 0) return 'Please enter a valid positive number';
      }
    });

    if (isCancel(days)) {
      cancel('Operation cancelled');
      process.exit(0);
    }

    expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + parseInt(days as string));
  }

  const s = spinner();
  s.start('Pushing entitlement...');
  await createEntitlement(userId, tier as number, note, expiryDate);
  s.stop('Done.');

  outro('Entitlement updated successfully');
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
