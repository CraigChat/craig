import { User } from '@prisma/client';

import prisma from '../lib/prisma';

export async function setNextAvailableService(user: User, exclude: string) {
  const services = ['google', 'microsoft'].filter((s) => s !== exclude);

  for (const service of services) {
    let serviceData;
    switch (service) {
      case 'google':
        serviceData = await prisma.googleDriveUser.findUnique({ where: { id: user.id } });
        break;
      case 'microsoft':
        serviceData = await prisma.microsoftUser.findUnique({ where: { id: user.id } });
        break;
    }

    if (serviceData)
      return void (await prisma.user.update({
        where: { id: user.id },
        data: { driveService: service }
      }));
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { driveEnabled: false }
  });
}
