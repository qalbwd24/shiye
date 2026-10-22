import { promises as fs } from 'node:fs';
/** Windows scanners can briefly hold the destination between write and rename.
 * Retry only the same atomic rename; never rerun the business mutation, remove
 * the current library, copy over it, or acknowledge an uncommitted transaction.
 */
export async function renameLibraryFile(
  from,
  to,
  {
    rename = fs.rename,
    platform = process.platform,
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {},
) {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      if (
        platform !== 'win32' ||
        !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) ||
        attempt >= 3
      )
        throw error;
      await wait([20, 60, 180][attempt]);
    }
  }
}
