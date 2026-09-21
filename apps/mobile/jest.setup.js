// apps/mobile/jest.setup.js
// GH #54 — drain all jest-leaked timers. Two sources behind
// "A worker process has failed to exit gracefully":
//
//   1. RTL doesn't auto-unmount between tests; when react-query
//      observers tear down they schedule 5-minute gc setTimeouts via
//      `Mutation.scheduleGc` / `Removable.scheduleGc`.
//   2. react-query's `notifyManager` batches query-state notifications
//      with `setTimeout(callback, 0)`. If the test exits before that
//      micro-deferral fires, the worker keeps the handle open.
//
// Both kinds are captured when the whole test runs under fake timers;
// `jest.useRealTimers()` then discards the queue. Mounting fake
// timers globally is safe here because no test in this suite asserts
// wall-clock behaviour (they all advance via `await act()` /
// `await waitFor(...)` which are microtask-based, not setTimeout-based).
const { cleanup } = require('@testing-library/react-native');

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
});
