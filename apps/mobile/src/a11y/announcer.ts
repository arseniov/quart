// src/a11y/announcer.ts
export type AnnounceFn = (message: string, polite?: boolean) => void;

let announceImpl: AnnounceFn = () => undefined;

export function _setAnnouncer(fn: AnnounceFn) {
  announceImpl = fn;
}

export function announce(message: string, polite = true) {
  announceImpl(message, polite);
}

export function getAnnouncer(): AnnounceFn {
  return announceImpl;
}