// src/lib/log.ts
// ponytail: thin pass-through to console.* — purpose is to give jest a stable
//          spy surface per level. Sync mockImplementation(() => {}) keeps
//          jest workers from seeing console.warn as unfinished work during
//          deferred rejection paths. Upgrade: route through Sentry/logger
//          when structured logging lands.
export const log = {
  warn: (msg: string, ...args: unknown[]) => console.warn(msg, ...args),
  error: (msg: string, ...args: unknown[]) => console.error(msg, ...args),
  info: (msg: string, ...args: unknown[]) => console.info(msg, ...args),
};