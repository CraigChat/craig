import { ControlClient } from './controlClient.js';
import type { ControlEndpoint, EndpointStore } from './store.js';

interface MaintenanceTarget {
  name: string;
  endpoint?: ControlEndpoint;
  error?: string;
}

export interface MaintenanceUpdateResult {
  name: string;
  ok: boolean;
  enabled?: boolean;
  error?: string;
}

export async function resolveMaintenanceTargets(store: EndpointStore, selector: string): Promise<MaintenanceTarget[]> {
  if (selector === 'all') {
    const endpoints = await store.list();
    if (!endpoints.length) throw new Error('No endpoints configured.');
    return endpoints.map((endpoint) => ({ name: endpoint.name, endpoint }));
  }

  return Promise.all(
    parseEndpointSelector(selector).map(async (name) => {
      try {
        return { name, endpoint: await store.get(name) };
      } catch (error) {
        return { name, error: formatError(error) };
      }
    })
  );
}

export function parseEndpointSelector(value: string): string[] {
  const names = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!names.length) throw new Error('Endpoint selector must be a name, comma-separated names, or "all".');
  return [...new Set(names)];
}

export async function updateMaintenance(targets: MaintenanceTarget[], message?: string): Promise<MaintenanceUpdateResult[]> {
  return Promise.all(
    targets.map(async (target) => {
      if (!target.endpoint) return { name: target.name, ok: false, error: target.error || 'Unknown endpoint' };

      try {
        const result = await new ControlClient(target.endpoint).setMaintenance(message);
        return { name: target.endpoint.name, ok: true, enabled: result.enabled };
      } catch (error) {
        return { name: target.endpoint.name, ok: false, error: formatError(error) };
      }
    })
  );
}

export function formatMaintenanceUpdate(results: MaintenanceUpdateResult[], setting: boolean): string {
  const succeeded = results.filter((result) => result.ok).map((result) => result.name);
  const failed = results.filter((result) => !result.ok);
  const action = setting ? 'set' : 'removed';

  if (results.length === 1 && !failed.length) return setting ? 'Maintenance mode has been set.' : 'Maintenance mode has been removed.';

  const lines = [];
  if (succeeded.length) lines.push(`Maintenance mode has been ${action} for ${succeeded.join(', ')}.`);
  else lines.push(`Maintenance mode was not ${action} for any endpoints.`);

  if (failed.length) {
    lines.push('', 'Failed:', ...failed.map((result) => `- ${result.name}: ${result.error || 'Unknown error'}`));
  }

  return lines.join('\n');
}

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}
