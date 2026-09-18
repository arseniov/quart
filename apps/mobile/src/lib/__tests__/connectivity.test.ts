// src/lib/__tests__/connectivity.test.ts
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => () => {}),
    fetch: jest.fn(() => Promise.resolve({ isConnected: true, isInternetReachable: true })),
  },
}));

import NetInfo from '@react-native-community/netinfo';
import { shouldFlushOnChange, subscribeConnectivity, startAutoFlush } from '../connectivity';

const mNI = NetInfo as jest.Mocked<typeof NetInfo>;

beforeEach(() => {
  jest.clearAllMocks();
  // ponytail: each test gets a fresh unsubscribe fn
  mNI.addEventListener.mockReturnValue(() => {});
  mNI.fetch.mockResolvedValue({ isConnected: true, isInternetReachable: true } as never);
});

describe('shouldFlushOnChange', () => {
  it('triggers on offline → online edge', () => {
    expect(shouldFlushOnChange(false, true)).toBe(true);
  });

  it('does not trigger on online → offline', () => {
    expect(shouldFlushOnChange(true, false)).toBe(false);
  });

  it('does not trigger when both online', () => {
    expect(shouldFlushOnChange(true, true)).toBe(false);
  });

  it('does not trigger when both offline', () => {
    expect(shouldFlushOnChange(false, false)).toBe(false);
  });
});

describe('subscribeConnectivity', () => {
  // ponytail: the listener type from the real NetInfo signature. Use `unknown`-flavored state to
  //          avoid importing internal types in the test; production narrows on NetInfoState.
  type Listener = (state: { isConnected: boolean | null; isInternetReachable: boolean | null }) => void;
  let captured: Listener | null = null;

  beforeEach(() => {
    captured = null;
  });

  it('calls onFlush when the listener transitions offline → online', () => {
    mNI.addEventListener.mockImplementation(((cb: Listener) => {
      captured = cb;
      return () => {};
    }) as never);
    // ponytail: initial fetch resolves "online" so the first listener tick isn't an edge.
    mNI.fetch.mockResolvedValue({ isConnected: true, isInternetReachable: true } as never);

    const onFlush = jest.fn();
    subscribeConnectivity(onFlush);

    // simulate the next state event after priming
    captured?.({ isConnected: true, isInternetReachable: true });
    captured?.({ isConnected: true, isInternetReachable: true });
    expect(onFlush).not.toHaveBeenCalled();

    // offline → online edge
    captured?.({ isConnected: false, isInternetReachable: false });
    captured?.({ isConnected: true, isInternetReachable: true });
    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  it('treats isInternetReachable=null as online (Expo default)', () => {
    mNI.addEventListener.mockImplementation(((cb: Listener) => {
      captured = cb;
      return () => {};
    }) as never);
    mNI.fetch.mockResolvedValue({ isConnected: false, isInternetReachable: false } as never);

    const onFlush = jest.fn();
    subscribeConnectivity(onFlush);

    // first tick after priming: still offline
    captured?.({ isConnected: false, isInternetReachable: false });
    expect(onFlush).not.toHaveBeenCalled();

    // online edge: isInternetReachable=null is treated as online
    captured?.({ isConnected: true, isInternetReachable: null });
    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  it('returns the unsubscribe function from NetInfo.addEventListener', () => {
    const unsub = jest.fn();
    mNI.addEventListener.mockReturnValue(unsub);
    const stop = subscribeConnectivity(() => {});
    expect(stop).toBe(unsub);
  });

  it('does not call onFlush during the priming tick', () => {
    mNI.addEventListener.mockImplementation(((cb: Listener) => {
      captured = cb;
      return () => {};
    }) as never);
    // initial fetch resolves offline — the first tick should NOT be treated as offline→online.
    mNI.fetch.mockResolvedValue({ isConnected: false, isInternetReachable: false } as never);

    const onFlush = jest.fn();
    subscribeConnectivity(onFlush);

    captured?.({ isConnected: true, isInternetReachable: true });
    expect(onFlush).not.toHaveBeenCalled();
  });
});

describe('startAutoFlush', () => {
  it('returns an unsubscribe function', () => {
    const unsub = jest.fn();
    mNI.addEventListener.mockReturnValue(unsub);
    expect(typeof startAutoFlush()).toBe('function');
  });

  it('uses NetInfo as the subscription source', () => {
    mNI.addEventListener.mockReturnValue(() => {});
    startAutoFlush();
    expect(NetInfo.addEventListener).toHaveBeenCalledTimes(1);
  });
});
