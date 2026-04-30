import * as assert from 'assert';
import { ConnectionManager } from '../../src/core/db/ConnectionManager';
import { SchemaData, WorkerMessage } from '../../src/core/db/types';

// ---------------------------------------------------------------------------
// vscode mock — workspace.getConfiguration must return configurable values
// ---------------------------------------------------------------------------
import * as vscodeMock from './vscode.mock';
let _cfgGet: (key: string) => unknown = () => undefined;
(vscodeMock.workspace as unknown as { getConfiguration: () => unknown }).getConfiguration = () => ({
    get: (key: string) => _cfgGet(key),
});
function setConfigGet(fn: (key: string) => unknown) {
    _cfgGet = fn;
}

import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Mock Worker
// ---------------------------------------------------------------------------
/** Instances of this class are returned when `new Worker(...)` is intercepted. */
class SimulatedWorker extends EventEmitter {
    public postMessageQueue: WorkerMessage[] = [];

    postMessage(msg: WorkerMessage) {
        this.postMessageQueue.push(msg);
    }

    terminate() {
        return Promise.resolve(0);
    }
}

/** Class-level reference to SimulatedWorker so tests can drive events. */
let SimulatedWorkerClass: typeof SimulatedWorker & { _lastInstance?: SimulatedWorker | null } =
    SimulatedWorker;

// ---------------------------------------------------------------------------
// Per-test helper: replace Worker with the simulated class
// ---------------------------------------------------------------------------
let OriginalWorker: typeof ConnectionManager.WorkerClass;

function installWorkerMock() {
    OriginalWorker = ConnectionManager.WorkerClass;
    (ConnectionManager as unknown as { WorkerClass: unknown }).WorkerClass = SimulatedWorkerClass;
}

function restoreWorkerMock() {
    if (OriginalWorker) {
        (ConnectionManager as unknown as { WorkerClass: unknown }).WorkerClass = OriginalWorker;
    }
}

// ---------------------------------------------------------------------------
// Reset singleton — called before each test that needs a clean ConnectionManager
// ---------------------------------------------------------------------------
function resetSingleton() {
    // Wipe the static instance so getInstance() returns a fresh manager
    (ConnectionManager as unknown as { instance: unknown }).instance = undefined;
}

// ---------------------------------------------------------------------------
// Helpers to drive a SimulatedWorker from outside the worker
// ---------------------------------------------------------------------------
/** Flush all messages posted so far and simulate an async delivery. Returns the flushed messages. */
function flushMessages(sw: SimulatedWorker, delay = 0): Promise<WorkerMessage[]> {
    return new Promise<WorkerMessage[]>((resolve) => {
        setTimeout(() => {
            const msgs = sw.postMessageQueue.splice(0);
            resolve(msgs);
        }, delay);
    });
}

function fireConnected(sw: SimulatedWorker, success: true): void;
function fireConnected(sw: SimulatedWorker, success: false, error?: string): void;
function fireConnected(sw: SimulatedWorker, success: boolean, error = 'connection failed') {
    sw.emit('message', { type: 'CONNECTED', success, ...(success ? {} : { error }) });
}

function fireSchemaData(sw: SimulatedWorker, data: SchemaData) {
    sw.emit('message', { type: 'SCHEMA_DATA', data });
}

function fireSimulationResult(sw: SimulatedWorker, rowCount: number, error?: string) {
    sw.emit('message', { type: 'SIMULATION_RESULT', rowCount, ...(error ? { error } : {}) });
}

function fireError(sw: SimulatedWorker, errorMsg: string) {
    sw.emit('message', { type: 'ERROR', error: errorMsg });
}

function fireWorkerError(sw: SimulatedWorker, errorMsg: string) {
    sw.emit('error', new Error(errorMsg));
}

// ---------------------------------------------------------------------------
// Access the active SimulatedWorker from a manager (for event injection)
// ---------------------------------------------------------------------------
function getWorker(): SimulatedWorker {
    return (SimulatedWorkerClass as unknown as { _lastInstance: SimulatedWorker })._lastInstance;
}

// Patch SimulatedWorker to register itself when instantiated
SimulatedWorkerClass._lastInstance = null;
class TrackedSimulatedWorker extends SimulatedWorker {
    constructor() {
        super();
        SimulatedWorkerClass._lastInstance = this;
    }
}
SimulatedWorkerClass = TrackedSimulatedWorker as unknown as typeof SimulatedWorker & {
    _lastInstance?: SimulatedWorker | null;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('ConnectionManager', () => {
    beforeEach(() => {
        installWorkerMock();
        setConfigGet(() => undefined); // default: 'auto'
    });

    afterEach(() => {
        restoreWorkerMock();
        setConfigGet(() => undefined);
    });

    // -------------------------------------------------------------------------
    // 1. Singleton pattern
    // -------------------------------------------------------------------------
    describe('getInstance()', () => {
        it('returns the same instance across multiple calls', () => {
            resetSingleton(); // ensure clean slate first
            const a = ConnectionManager.getInstance();
            const b = ConnectionManager.getInstance();
            assert.strictEqual(a, b, 'getInstance() should return the exact same object');
        });
    });

    // -------------------------------------------------------------------------
    // 2. connect() — valid connection string
    // -------------------------------------------------------------------------
    describe('connect()', () => {
        it('resolves true when worker responds with CONNECTED success', async () => {
            resetSingleton();
            const manager2 = ConnectionManager.getInstance();

            const connectPromise = manager2.connect('postgres://localhost:5432');
            await flushMessages(getWorker());
            fireConnected(getWorker(), true);

            const result = await connectPromise;
            assert.strictEqual(result.success, true);
        });

        it('returns false immediately when already connecting (no duplicate)', async () => {
            resetSingleton();
            const manager2 = ConnectionManager.getInstance();

            const p1 = manager2.connect('postgres://localhost:5432');
            const p2 = manager2.connect('postgres://localhost:5432');

            const r2 = await p2;
            assert.strictEqual(r2.success, false, 'Second connect should return false immediately');

            await flushMessages(getWorker());
            fireConnected(getWorker(), true);
            await p1;
        });

        it('starts a new connection when already connected (reconnects)', async () => {
            resetSingleton();
            const manager2 = ConnectionManager.getInstance();

            const p1 = manager2.connect('postgres://localhost:5431');
            await flushMessages(getWorker());
            fireConnected(getWorker(), true);
            await p1;

            const worker1 = getWorker();

            const p2 = manager2.connect('postgres://localhost:5432');
            const worker2 = getWorker();
            assert.notStrictEqual(worker1, worker2);

            await flushMessages(worker2);
            fireConnected(worker2, true);
            const result = await p2;
            assert.strictEqual(result.success, true);
        });

        it('resolves SSL mode as DISABLE for localhost when config is auto', async () => {
            resetSingleton();
            const manager2 = ConnectionManager.getInstance();

            const p = manager2.connect('postgres://localhost:5432');
            const sw = getWorker();
            const msgs = await flushMessages(sw);
            const connectMsg = msgs[0];
            if (connectMsg.type === 'CONNECT') {
                assert.strictEqual(connectMsg.sslMode, 'disable');
            } else {
                assert.fail('Expected CONNECT message');
            }

            fireConnected(sw, true);
            await p;
        });

        it('respects explicit sslMode=require from queryguard config', async () => {
            resetSingleton();
            const manager2 = ConnectionManager.getInstance();

            setConfigGet((key) => (key === 'sslMode' ? 'require' : undefined));

            const p = manager2.connect('postgres://localhost:5432');
            const sw = getWorker();
            const msgs = await flushMessages(sw);
            const connectMsg = msgs[0];
            if (connectMsg.type === 'CONNECT') {
                assert.strictEqual(connectMsg.sslMode, 'require');
            } else {
                assert.fail('Expected CONNECT message');
            }

            fireConnected(sw, true);
            await p;
        });
    });

    // -------------------------------------------------------------------------
    // 8. Message handling — CONNECTED failure
    // -------------------------------------------------------------------------
    describe('message handling — CONNECTED failure', () => {
        it('sets isConnecting=false and returns false on CONNECTED failure', async () => {
            resetSingleton();
            const manager = ConnectionManager.getInstance();

            const p = manager.connect('postgres://user:pass@badhost:5432/db');
            const sw = getWorker();
            await flushMessages(sw);
            fireConnected(sw, false, 'authentication failed');

            const result = await p;
            assert.strictEqual(result.success, false);
            assert.strictEqual(result.error, 'authentication failed');
            assert.strictEqual(manager.getIsConnected(), false);
        });
    });

    // -------------------------------------------------------------------------
    // message handling — SCHEMA_DATA
    // -------------------------------------------------------------------------
    describe('message handling — SCHEMA_DATA', () => {
        it('calls onSchemaUpdate callback when worker sends SCHEMA_DATA', async () => {
            resetSingleton();
            const manager = ConnectionManager.getInstance();

            let receivedData: SchemaData | null = null;
            manager.setOnSchemaUpdate((data) => {
                receivedData = data;
            });

            const p = manager.connect('postgres://user:pass@localhost:5432/db');
            const sw = getWorker();
            await flushMessages(sw);
            fireConnected(sw, true);
            await p;

            const mockSchema: SchemaData = {
                tables: [{ tableName: 'users', rowCount: 42 }],
                relationships: [],
                timestamp: Date.now(),
            };
            fireSchemaData(sw, mockSchema);

            assert.ok(receivedData !== null, 'onSchemaUpdate should have been called');
            assert.strictEqual(
                (receivedData as unknown as SchemaData).tables[0].tableName,
                'users'
            );
        });
    });

    // -------------------------------------------------------------------------
    // 9. Message handling — SIMULATION_RESULT
    // -------------------------------------------------------------------------
    describe('message handling — SIMULATION_RESULT', () => {
        it('calls onSimulationResult callback when worker sends SIMULATION_RESULT', async () => {
            resetSingleton();
            const manager = ConnectionManager.getInstance();

            let receivedRowCount: number | null = null;
            let receivedError: string | undefined;
            manager.setOnSimulationResult((rowCount, error) => {
                receivedRowCount = rowCount;
                receivedError = error;
            });

            const p = manager.connect('postgres://localhost:5432');
            const sw = getWorker();
            await flushMessages(sw);
            fireConnected(sw, true);
            await p;

            fireSimulationResult(sw, 5);

            assert.strictEqual(receivedRowCount, 5);
            assert.strictEqual(receivedError, undefined);
        });

        it('passes error string to onSimulationResult callback', async () => {
            resetSingleton();
            const manager = ConnectionManager.getInstance();

            let receivedError: string | undefined;
            manager.setOnSimulationResult((_, error) => {
                receivedError = error;
            });

            const p = manager.connect('postgres://localhost:5432');
            const sw = getWorker();
            await flushMessages(sw);
            fireConnected(sw, true);
            await p;

            fireSimulationResult(sw, 0, 'syntax error at or near SELECT');

            assert.strictEqual(receivedError, 'syntax error at or near SELECT');
        });
    });

    // -------------------------------------------------------------------------
    // 10. Message handling — ERROR
    // -------------------------------------------------------------------------
    describe('message handling — ERROR', () => {
        it('calls onError callback when worker sends ERROR', async () => {
            resetSingleton();
            const manager = ConnectionManager.getInstance();

            let receivedError: string | null = null;
            manager.setOnError((err) => {
                receivedError = err;
            });

            const p = manager.connect('postgres://localhost:5432');
            const sw = getWorker();
            await flushMessages(sw);
            fireConnected(sw, true);
            await p;

            fireError(sw, 'connection lost');

            assert.strictEqual(receivedError, 'connection lost');
        });
    });

    // -------------------------------------------------------------------------
    // 11. worker onerror handler
    // -------------------------------------------------------------------------
    describe('worker onerror handler', () => {
        it('sets isConnected=false and calls onError when worker emits error', async () => {
            resetSingleton();
            const manager = ConnectionManager.getInstance();

            let receivedError: string | null = null;
            manager.setOnError((err) => {
                receivedError = err;
            });

            const p = manager.connect('postgres://localhost:5432');
            const sw = getWorker();
            await flushMessages(sw);
            fireConnected(sw, true);
            await p;

            fireWorkerError(sw, 'worker thread fatal error');

            assert.strictEqual(manager.getIsConnected(), false);
            assert.strictEqual(receivedError, 'worker thread fatal error');
        });
    });

    // -------------------------------------------------------------------------
    // 12. querySchema()
    // -------------------------------------------------------------------------
    describe('querySchema()', () => {
        it('is a no-op when worker is not connected (does not throw)', () => {
            const manager = ConnectionManager.getInstance();
            assert.doesNotThrow(() => manager.querySchema());
        });

        it('sends QUERY_SCHEMA message when connected', async () => {
            resetSingleton();
            const manager = ConnectionManager.getInstance();

            const p = manager.connect('postgres://localhost:5432');
            const sw = getWorker();
            await flushMessages(sw);
            fireConnected(sw, true);
            await p;

            sw.postMessageQueue = []; // clear CONNECT message
            manager.querySchema();

            const msgs = sw.postMessageQueue;
            assert.strictEqual(msgs.length, 1);
            assert.strictEqual(msgs[0].type, 'QUERY_SCHEMA');
        });
    });

    // -------------------------------------------------------------------------
    // 13. simulate()
    // -------------------------------------------------------------------------
    describe('simulate()', () => {
        it('is a no-op when worker is not connected (does not throw)', () => {
            const manager = ConnectionManager.getInstance();
            assert.doesNotThrow(() => manager.simulate('SELECT 1'));
        });

        it('sends SIMULATE message with sql and params when connected', async () => {
            resetSingleton();
            const manager = ConnectionManager.getInstance();

            const p = manager.connect('postgres://localhost:5432');
            const sw = getWorker();
            await flushMessages(sw);
            fireConnected(sw, true);
            await p;

            sw.postMessageQueue = []; // clear CONNECT message
            manager.simulate('DELETE FROM users', ['arg1']);

            const msgs = sw.postMessageQueue;
            assert.strictEqual(msgs.length, 1);
            const msg = msgs[0];
            assert.strictEqual(msg.type, 'SIMULATE');
            if (msg.type === 'SIMULATE') {
                assert.strictEqual(msg.sql, 'DELETE FROM users');
                assert.deepStrictEqual(msg.params, ['arg1']);
            } else {
                assert.fail('Expected SIMULATE message');
            }
        });
    });

    // -------------------------------------------------------------------------
    // 14. disconnect()
    // -------------------------------------------------------------------------
    describe('disconnect()', () => {
        it('terminates the worker and sets isConnected=false', async () => {
            resetSingleton();
            const manager = ConnectionManager.getInstance();

            const p = manager.connect('postgres://localhost:5432');
            const sw = getWorker();
            await flushMessages(sw);
            fireConnected(sw, true);
            await p;

            await manager.disconnect();
            assert.strictEqual(manager.getIsConnected(), false);
        });

        it('resolves even when there is no worker', async () => {
            resetSingleton();
            const manager = ConnectionManager.getInstance();
            await manager.disconnect();
            assert.strictEqual(manager.getIsConnected(), false);
        });
    });

    // -------------------------------------------------------------------------
    // 15. setWorkerPath()
    // -------------------------------------------------------------------------
    describe('setWorkerPath()', () => {
        it('accepts a custom worker path without throwing', async () => {
            resetSingleton();
            const manager = ConnectionManager.getInstance();
            manager.setWorkerPath('/custom/path.js');

            const p = manager.connect('postgres://localhost:5432');
            const sw = getWorker();
            await flushMessages(sw);
            fireConnected(sw, true);
            await p;

            assert.strictEqual(manager.getIsConnected(), true);
        });
    });

    // -------------------------------------------------------------------------
    // 16. setOnError()
    // -------------------------------------------------------------------------
    describe('setOnError()', () => {
        it('registers a callback that is invoked on worker error', async () => {
            resetSingleton();
            const manager = ConnectionManager.getInstance();

            let errorCalled = false;
            manager.setOnError(() => {
                errorCalled = true;
            });

            const p = manager.connect('postgres://localhost:5432');
            const sw = getWorker();
            await flushMessages(sw);
            fireConnected(sw, true);
            await p;

            fireWorkerError(sw, 'unhandled worker crash');
            assert.strictEqual(errorCalled, true);
        });
    });
});

