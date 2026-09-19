// src/lib/connectivity.ts
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { flushQueue } from './offline-queue';

// ponytail: "online when in doubt" — `isInternetReachable === null` is treated as online because
//          NetInfo often can't probe reachable state on flaky networks. The ceiling here is
//          that we may attempt a flush when the device really is offline; the cost is one wasted
//          short-circuit, not a missed sync. Flip to `=== true` if/when a "definitely offline" UX lands.
function isOnline(state: NetInfoState): boolean {
  return Boolean(state.isConnected) && state.isInternetReachable !== false;
}

export function shouldFlushOnChange(prev: boolean, next: boolean): boolean {
  return !prev && next;
}

export function subscribeConnectivity(onFlush: () => void): () => void {
  let last = false;
  let primed = false;

  // ponytail: priming via fetch() avoids a spurious "offline → online" edge on app boot when the
  //          first listener tick already reports online. Without this we'd flush once at launch.
  void NetInfo.fetch().then((state) => {
    last = isOnline(state);
    primed = true;
  });

  const unsubscribe = NetInfo.addEventListener((state) => {
    const now = isOnline(state);
    if (!primed) {
      last = now;
      primed = true;
      return;
    }
    if (shouldFlushOnChange(last, now)) {
      onFlush();
    }
    last = now;
  });

  // ponytail: NetInfo v11 returns `() => void`; older v9/v10 returned `EventSubscription`.
  //          Handle both for forward-compat (a future RN upgrade may re-shape the return type).
  return typeof unsubscribe === 'function'
    ? (unsubscribe as () => void)
    : (unsubscribe as unknown as { remove?: () => void })?.remove ?? (() => {});
}

export function startAutoFlush(): () => void {
  // ponytail: caller owns the returned unsubscribe — typically a root-layout useEffect cleanup.
  return subscribeConnectivity(() => {
    void flushQueue();
  });
}
