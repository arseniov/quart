// src/lib/offline-queue.ts
import { randomUUID } from 'expo-crypto';
import { apiClient } from '@/api/client';
import { mmkv } from './storage';

// ponytail: storage keys hoisted to module-level constants so renames don't drift between read/write sites.
//          Bumping the suffix is the migration path if the schema changes.
const QUEUE_KEY = 'quart.offline.queue.v1';
const DLQ_KEY = 'quart.offline.dlq.v1';
const MAX_ATTEMPTS = 5;

export type QueuedAction =
  | {
      kind: 'create_issue';
      id: string;
      payload: Record<string, unknown>;
      photos: string[];
      attempts: number;
      queued_at: string;
    }
  | {
      kind: 'mark_notification_read';
      id: string;
      notificationId: string;
      attempts: number;
      queued_at: string;
    };

function readList(key: string): QueuedAction[] {
  const raw = mmkv.getString(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as QueuedAction[]) : [];
  } catch {
    // ponytail: corrupt JSON in MMKV is treated as empty; the next enqueue overwrites it.
    return [];
  }
}

function writeList(key: string, list: QueuedAction[]): void {
  mmkv.set(key, JSON.stringify(list));
}

export function loadQueue(): QueuedAction[] {
  return readList(QUEUE_KEY);
}

export function loadDlq(): QueuedAction[] {
  return readList(DLQ_KEY);
}

// ponytail: compile-time shapes for the action inputs (without the auto-set id/attempts/queued_at).
type CreateIssueInput = { kind: 'create_issue'; payload: Record<string, unknown>; photos: string[] };
type MarkNotificationReadInput = { kind: 'mark_notification_read'; notificationId: string };
export type EnqueueInput = CreateIssueInput | MarkNotificationReadInput;

// ponytail: overloads give per-kind return types (CreateIssueInput → create_issue variant, etc.)
//          rather than the wider union. Without this, callers get a discriminated union back
//          and have to re-narrow on `.kind`.
export function enqueue(action: CreateIssueInput): Extract<QueuedAction, { kind: 'create_issue' }>;
export function enqueue(action: MarkNotificationReadInput): Extract<QueuedAction, { kind: 'mark_notification_read' }>;
export function enqueue(action: EnqueueInput): QueuedAction {
  const full: QueuedAction = {
    ...action,
    id: randomUUID(),
    attempts: 0,
    queued_at: new Date().toISOString(),
  } as QueuedAction;
  writeList(QUEUE_KEY, [...loadQueue(), full]);
  return full;
}

export function removeFromQueue(id: string): void {
  // ponytail: id-based filter, not JSON.stringify equality — two equal payloads collide otherwise.
  writeList(QUEUE_KEY, loadQueue().filter((a) => a.id !== id));
}

function moveToDlq(action: QueuedAction): void {
  writeList(DLQ_KEY, [...loadDlq(), action]);
  removeFromQueue(action.id);
}

async function flushOne(action: QueuedAction): Promise<boolean> {
  try {
    if (action.kind === 'create_issue') {
      await apiClient.post('/issues', action.payload);
    } else if (action.kind === 'mark_notification_read') {
      await apiClient.post(`/notifications/${action.notificationId}/read`);
    }
    return true;
  } catch {
    // ponytail: swallow per-action errors here; flushQueue reports { ok, failed } counts.
    //          apiClient's ApiError carries status; we don't need it for the retry decision.
    return false;
  }
}

export async function flushQueue(): Promise<{ ok: number; failed: number }> {
  // ponytail: serial flush — concurrent would race on the queue mutation and double-flush the same action.
  //          Switch to chunked-parallel with per-action dedupe if flush latency > 100ms in production.
  const queue = loadQueue();
  let ok = 0;
  let failed = 0;
  for (const action of queue) {
    const success = await flushOne(action);
    if (success) {
      removeFromQueue(action.id);
      ok++;
    } else {
      const nextAttempts = action.attempts + 1;
      if (nextAttempts >= MAX_ATTEMPTS) {
        moveToDlq({ ...action, attempts: nextAttempts });
      } else {
        const updated = loadQueue().map((a) =>
          a.id === action.id ? { ...a, attempts: nextAttempts } : a
        );
        writeList(QUEUE_KEY, updated);
      }
      failed++;
    }
  }
  return { ok, failed };
}

// ponytail: MAX_ATTEMPTS is exported for tests/callers that need to reason about retry budget.
export const OFFLINE_QUEUE_MAX_ATTEMPTS = MAX_ATTEMPTS;
