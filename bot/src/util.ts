import { Guild } from '@prisma/client';
import { Member } from 'slash-create';

export function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function makeError(obj: any) {
  const err = new Error(obj.message);
  err.name = obj.name;
  err.stack = obj.stack;
  return err;
}

export function makePlainError(err: Error) {
  const obj: any = {};
  obj.name = err.name;
  obj.message = err.message;
  obj.stack = err.stack;
  return obj;
}

export function checkRecordingPermission(member: Member, guildData?: Guild | null) {
  if (!member) return false;
  if (member.permissions.has('MANAGE_GUILD')) return true;
  if (guildData && member.roles.some((r) => guildData.accessRoles.some((g) => g === r))) return true;
  return false;
}

export function cutoffText(text: string, limit = 2000) {
  return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
}
