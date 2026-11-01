import * as assert from 'assert';
import {
    ConnectionManager,
    type ConnectionState,
    type WorkerLike,
} from '../../src/db/ConnectionManager';
import type { WorkerRequest, WorkerResponse } from '../../src/db/protocol';

type Handler = (req: WorkerRequest) => WorkerResponse | undefined | 'hang';

class FakeWorker implements WorkerLike {
    private listeners: Record<string, ((v: never) => void)[]> = {};
    public requests: WorkerRequest[] = [];
    public terminated = false;

    constructor(private readonly handler: Handler) {}

    on(event: string, listener: (v: never) => void): this {
        (this.listeners[event] ??= []).push(listener);
        return this;
    }

    emit(event: string, value: unknown): void {
        for (const l of this.listeners[event] ?? []) l(value as never);
    }

    postMessage(req: WorkerRequest): void {
        this.requests.push(req);
        const res = this.handler(req);
        if (res && res !== 'hang') setImmediate(() => this.emit('message', res));
    }

    async terminate(): Promise<number> {
        this.terminated = true;
        setImmediate(() => this.emit('exit', 1));
        return 1;
    }
}

const ok = (req: WorkerRequest, result: unknown): WorkerResponse => ({
    kind: 'response',
    id: req.id,
    ok: true,
    result,
});

const happy: Handler = (req) => {
    switch (req.type) {
        case 'connect':
            return ok(req, { serverVersion: 170000 });
        case 'count':
            return ok(req, { counts: req.payload.queries.map(() => 3), durationMs: 1 });
        default:
            return ok(req, undefined);
    }
};

const PAYLOAD = { connectionString: 'postgres://x', ssl: false as const, applicationName: 'test' };
const PROFILE = { id: 'p1', name: 'Local' };

describe('ConnectionManager', () => {
    it('connects, reports state and answers requests by id', async () => {
        const workers: FakeWorker[] = [];
        const cm = new ConnectionManager('w.js', () => {
            const w = new FakeWorker(happy);
            workers.push(w);
            return w;
        });
        const states: ConnectionState['status'][] = [];
        cm.onDidChangeState((s) => states.push(s.status));

        await cm.connect(PROFILE, PAYLOAD);
        assert.ok(cm.isConnected);
        const [a, b] = await Promise.all([
            cm.count({ queries: ['q1'], params: [], statementTimeoutMs: 1000 }),
            cm.count({ queries: ['q1', 'q2'], params: [], statementTimeoutMs: 1000 }),
        ]);
        assert.deepStrictEqual(a.counts, [3]);
        assert.deepStrictEqual(b.counts, [3, 3]);
        await cm.disconnect();
        assert.deepStrictEqual(states, ['connecting', 'connected', 'disconnected']);
        assert.ok(workers[0].terminated);
    });

    it('maps worker errors to friendly messages and resets state', async () => {
        const cm = new ConnectionManager(
            'w.js',
            () =>
                new FakeWorker((req) => ({
                    kind: 'response',
                    id: req.id,
                    ok: false,
                    error: { message: 'password authentication failed', code: '28P01' },
                }))
        );
        await assert.rejects(cm.connect(PROFILE, PAYLOAD), /Authentication failed/);
        assert.strictEqual(cm.state.status, 'disconnected');
    });

    it('times out a hung count, kills the worker and disconnects', async function () {
        this.timeout(20_000);
        let worker: FakeWorker | undefined;
        const cm = new ConnectionManager('w.js', () => {
            worker = new FakeWorker((req) => (req.type === 'count' ? 'hang' : happy(req)));
            return worker;
        });
        await cm.connect(PROFILE, PAYLOAD);
        // statementTimeoutMs is tiny but the client adds a fixed grace period; shorten it via a fake timer.
        const original = global.setTimeout;
        (global as { setTimeout: unknown }).setTimeout = ((fn: () => void) =>
            original(fn, 5)) as unknown;
        try {
            await assert.rejects(
                cm.count({ queries: ['q'], params: [], statementTimeoutMs: 1 }),
                /did not answer/
            );
        } finally {
            (global as { setTimeout: unknown }).setTimeout = original;
        }
        assert.ok(worker?.terminated);
        assert.strictEqual(cm.state.status, 'disconnected');
    });

    it('a newer connect supersedes one issued in the same tick (no orphan worker)', async () => {
        const workers: FakeWorker[] = [];
        const cm = new ConnectionManager('w.js', () => {
            const w = new FakeWorker(happy);
            workers.push(w);
            return w;
        });
        const first = cm.connect({ id: 'a', name: 'A' }, PAYLOAD);
        const second = cm.connect({ id: 'b', name: 'B' }, PAYLOAD);
        await assert.rejects(first, /superseded/);
        await second;
        assert.strictEqual(workers.length, 1);
        assert.strictEqual(cm.state.status === 'connected' && cm.state.profileId, 'b');
    });

    it('a newer connect supersedes one whose worker is already waiting', async () => {
        const workers: FakeWorker[] = [];
        const cm = new ConnectionManager('w.js', () => {
            const slow = workers.length === 0;
            const w = new FakeWorker((req) =>
                req.type === 'connect' && slow ? 'hang' : happy(req)
            );
            workers.push(w);
            return w;
        });
        const first = cm.connect({ id: 'a', name: 'A' }, PAYLOAD);
        await new Promise((r) => setImmediate(r));
        assert.strictEqual(workers.length, 1);
        const second = cm.connect({ id: 'b', name: 'B' }, PAYLOAD);
        await assert.rejects(first);
        await second;
        assert.ok(workers[0].terminated);
        assert.strictEqual(cm.state.status === 'connected' && cm.state.profileId, 'b');
    });

    it('rejects requests when not connected', async () => {
        const cm = new ConnectionManager('w.js', () => new FakeWorker(happy));
        await assert.rejects(cm.fetchSchema(), /Not connected/);
    });

    it('rejects pending requests when the worker crashes', async () => {
        let worker: FakeWorker | undefined;
        const cm = new ConnectionManager('w.js', () => {
            worker = new FakeWorker((req) => (req.type === 'fetchSchema' ? 'hang' : happy(req)));
            return worker;
        });
        await cm.connect(PROFILE, PAYLOAD);
        const pending = cm.fetchSchema();
        worker!.emit('exit', 1);
        await assert.rejects(pending, /exited/);
        assert.strictEqual(cm.state.status, 'disconnected');
    });
});
