import fs from 'node:fs/promises';
import path from 'node:path';

export interface ControlEndpoint {
  name: string;
  url: string;
  token: string;
  applicationID?: string;
  createdAt: string;
  updatedAt: string;
}

interface EndpointStoreData {
  version: 1;
  endpoints: ControlEndpoint[];
}

const STORE_VERSION = 1;
const ENDPOINT_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

export class EndpointStore {
  constructor(readonly file: string) {}

  async list(): Promise<ControlEndpoint[]> {
    return [...(await this.read()).endpoints].sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(name: string): Promise<ControlEndpoint> {
    const endpoint = (await this.read()).endpoints.find((item) => item.name === name);
    if (!endpoint) throw new Error(`No endpoint named "${name}"`);
    return endpoint;
  }

  async add(name: string, url: string, token: string): Promise<ControlEndpoint> {
    const normalizedName = normalizeName(name);
    const normalizedUrl = normalizeUrl(url);
    if (!token) throw new Error('Endpoint token is required.');

    const data = await this.read();
    const now = new Date().toISOString();
    const existing = data.endpoints.find((endpoint) => endpoint.name === normalizedName);
    if (existing) {
      existing.url = normalizedUrl;
      existing.token = token;
      existing.updatedAt = now;
      await this.write(data);
      return existing;
    }

    const endpoint = {
      name: normalizedName,
      url: normalizedUrl,
      token,
      createdAt: now,
      updatedAt: now
    };
    data.endpoints.push(endpoint);
    await this.write(data);
    return endpoint;
  }

  async remove(name: string): Promise<boolean> {
    const data = await this.read();
    const nextEndpoints = data.endpoints.filter((endpoint) => endpoint.name !== name);
    if (nextEndpoints.length === data.endpoints.length) return false;
    await this.write({ ...data, endpoints: nextEndpoints });
    return true;
  }

  async updateApplicationID(name: string, applicationID: string | null | undefined): Promise<void> {
    if (!applicationID) return;

    const data = await this.read();
    const endpoint = data.endpoints.find((item) => item.name === name);
    if (!endpoint || endpoint.applicationID === applicationID) return;

    endpoint.applicationID = applicationID;
    endpoint.updatedAt = new Date().toISOString();
    await this.write(data);
  }

  private async read(): Promise<EndpointStoreData> {
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw) as Partial<EndpointStoreData>;
      if (parsed.version !== STORE_VERSION || !Array.isArray(parsed.endpoints)) throw new Error('Invalid botctl endpoint store.');
      return {
        version: STORE_VERSION,
        endpoints: parsed.endpoints.map((endpoint) => ({
          name: normalizeName(endpoint.name),
          url: normalizeUrl(endpoint.url),
          token: String(endpoint.token ?? ''),
          applicationID: endpoint.applicationID ? String(endpoint.applicationID) : undefined,
          createdAt: String(endpoint.createdAt ?? new Date(0).toISOString()),
          updatedAt: String(endpoint.updatedAt ?? endpoint.createdAt ?? new Date(0).toISOString())
        }))
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: STORE_VERSION, endpoints: [] };
      throw error;
    }
  }

  private async write(data: EndpointStoreData) {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(tmp, this.file);
    await fs.chmod(this.file, 0o600).catch(() => {});
  }
}

export function normalizeName(name: unknown): string {
  const normalized = String(name ?? '').trim();
  if (!ENDPOINT_NAME_PATTERN.test(normalized))
    throw new Error('Endpoint names must be 1-64 characters and use letters, numbers, underscores, or dashes.');
  return normalized;
}

export function normalizeUrl(url: unknown): string {
  const parsed = new URL(String(url ?? '').trim());
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Endpoint URLs must use http or https.');
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}
