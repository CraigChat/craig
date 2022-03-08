import { DataManager, DexareClient, ThrottleObject } from 'dexare';
import { client } from '.';

/** Data manager in Dexare using memory. */
export default class MemoryDataManager extends DataManager {
  constructor(client: DexareClient<any>) {
    super(client, {
      name: 'redis-data',
      description: 'Dexare data manager using Redis.'
    });

    this.filePath = __filename;
  }

  async getThrottle(scope: string, id: string) {
    const data = await client.get(`throttle:${scope}:${id}`);
    if (!data) return;
    return JSON.parse(data);
  }

  async setThrottle(scope: string, id: string, object: ThrottleObject) {
    return void (await client.set(`throttle:${scope}:${id}`, JSON.stringify(object), 'EX', object.reset));
  }

  async removeThrottle(scope: string, id: string) {
    return void (await client.del(`throttle:${scope}:${id}`));
  }
}
