import type { HttpRequest, HttpResponse } from 'uWebSockets.js';

import { ADDRESS_HEADER, XFF_DEPTH } from './config.js';

// Same ADDRESS_HEADER/XFF_DEPTH semantics as the SvelteKit apps (adapter-node)
export function getClientAddress(res: HttpResponse, req: HttpRequest) {
  const remoteAddress = Buffer.from(res.getRemoteAddressAsText()).toString();
  if (!ADDRESS_HEADER) return remoteAddress;
  const value = req.getHeader(ADDRESS_HEADER);
  if (!value) return remoteAddress;
  if (ADDRESS_HEADER !== 'x-forwarded-for') return value.trim();

  const addresses = value.split(',');
  if (XFF_DEPTH > addresses.length) return remoteAddress;
  return addresses[addresses.length - XFF_DEPTH].trim();
}
