import { createLiveActivityClient } from '../src/native/liveActivity';
import type { Spec } from '../src/native/NativeLiveActivity';
import type { Session } from '../src/timer/timerModel';
import { createFakeNative } from '../test/fakeNativeLiveActivity';

const session = (id: string): Session => ({
  id,
  name: id,
  goalSeconds: 60,
  startDate: 0,
  pausedAt: null,
  activityShown: false,
});

type Deferred = { label: string; resolve: () => void };

/**
 * A native module whose every call hangs until the test releases it, so we
 * can resolve calls in any order and check the queue still serializes them.
 */
function createGatedNative() {
  const pending: Deferred[] = [];
  const started: string[] = [];
  const gate = (label: string) =>
    new Promise<void>(resolve => {
      started.push(label);
      pending.push({ label, resolve });
    });
  const spec = {
    areActivitiesEnabled: () => true,
    startActivity: async (s: { sessionId: string }) => {
      await gate(`start:${s.sessionId}`);
      return `act-${s.sessionId}`;
    },
    updateActivity: async () => gate('update'),
    endActivity: async (id: string) => gate(`end:${id}`),
    endAllActivities: async () => gate('endAll'),
    listActivities: async () => {
      await gate('list');
      return [];
    },
  } as unknown as Spec;
  return { spec, pending, started };
}

const flush = () => new Promise<void>(r => setImmediate(() => r()));

describe('liveActivity client queue', () => {
  it('sends rapid start/stop calls to native strictly one at a time, in order', async () => {
    const native = createGatedNative();
    const client = createLiveActivityClient(native.spec);

    client.start(session('A'));
    client.endAll();
    client.start(session('B'));
    client.endAll();

    const order: string[] = [];
    for (let i = 0; i < 4; i++) {
      await flush();
      // Only one call is ever in flight.
      expect(native.pending).toHaveLength(1);
      const next = native.pending.shift()!;
      order.push(next.label);
      next.resolve();
    }
    await client.idle();
    expect(order).toEqual(['start:A', 'endAll', 'start:B', 'endAll']);
  });

  it('leaves no activities behind after a burst of start/stop', async () => {
    const fake = createFakeNative();
    const client = createLiveActivityClient(fake.spec);
    for (let i = 0; i < 20; i++) {
      client.start(session(`s${i}`));
      client.endAll();
    }
    await client.idle();
    expect(fake.activities).toHaveLength(0);
  });

  it('keeps exactly one activity when a burst ends on start', async () => {
    const fake = createFakeNative();
    const client = createLiveActivityClient(fake.spec);
    for (let i = 0; i < 20; i++) {
      client.start(session(`s${i}`));
      client.endAll();
    }
    client.start(session('last'));
    await client.idle();
    expect(fake.activities.map(a => a.sessionId)).toEqual(['last']);
  });

  it('keeps going after a native failure and reports a fallback', async () => {
    const fake = createFakeNative();
    const log = jest.fn();
    const failing = {
      ...fake.spec,
      startActivity: jest.fn().mockRejectedValue(new Error('denied')),
    } as Spec;
    const client = createLiveActivityClient(failing, log);

    await expect(client.start(session('A'))).resolves.toBeNull();
    await expect(client.list()).resolves.toEqual([]);
    expect(log).toHaveBeenCalledWith('start failed', expect.any(Error));
  });

  it('normalizes snapshots from native (missing ended/pausedAt)', async () => {
    const fake = createFakeNative();
    const sloppy = {
      ...fake.spec,
      listActivities: async () =>
        [{ activityId: 'a', sessionId: 's', startDate: 1 }] as never,
    } as Spec;
    const client = createLiveActivityClient(sloppy);
    await expect(client.list()).resolves.toEqual([
      {
        activityId: 'a',
        sessionId: 's',
        startDate: 1,
        pausedAt: null,
        ended: false,
      },
    ]);
  });

  it('is a safe no-op when the native module is missing', async () => {
    const client = createLiveActivityClient(null);
    expect(client.isAvailable()).toBe(false);
    expect(client.areEnabled()).toBe(false);
    await expect(client.start(session('A'))).resolves.toBeNull();
    await expect(client.list()).resolves.toEqual([]);
  });
});
