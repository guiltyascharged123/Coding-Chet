import type { Bootstrap } from './types.js';

export function newerSnapshot(current: Bootstrap | undefined, next: Bootstrap) {
  if (
    current?.serverId &&
    current.serverId === next.serverId &&
    current.revision !== undefined &&
    next.revision !== undefined &&
    current.revision > next.revision
  )
    return current;
  return next;
}
