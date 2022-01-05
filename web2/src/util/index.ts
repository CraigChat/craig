import { promises as fs } from 'fs';
import path from 'path';

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function iterateFolder(
  folderPath: string,
  callback: (filePath: string) => void | Promise<void>,
  extension: string = '.js'
) {
  const files = await fs.readdir(folderPath);
  await Promise.all(
    files.map(async (file) => {
      const filePath = path.join(folderPath, file);
      const stat = await fs.lstat(filePath);
      if (stat.isSymbolicLink()) {
        const realPath = await fs.readlink(filePath);
        if (stat.isFile() && file.endsWith(extension)) {
          await callback(realPath);
        } else if (stat.isDirectory()) {
          await iterateFolder(realPath, callback, extension);
        }
      } else if (stat.isFile() && file.endsWith(extension)) await callback(filePath);
      else if (stat.isDirectory()) await iterateFolder(filePath, callback, extension);
    })
  );
}

export function cutoffText(text: string, limit = 2000) {
  return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
}
