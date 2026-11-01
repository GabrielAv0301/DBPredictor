import { Worker } from 'worker_threads';
import type { SchemaSnapshot } from '../core/schema/types';
import { QueryGuardError, friendlyError } from '../shared/errors';
import { Emitter, type Disposable } from '../utils/events';
import { Logger } from '../utils/logger';
import type {
    ConnectPayload,
    ConnectResult,
    CountRequest,
    CountResult,
    WorkerRequest,
    WorkerResponse,
    WorkerResultMap,
} from './protocol';
import { totalBudgetMs } from './protocol';

export type ConnectionState =
    | { status: 'disconnected' }
    | { status: 'connecting'; profileId: string; profileName: string }
    | { status: 'connected'; profileId: string; profileName: string; serverVersion: number };

/** Subset of `worker_threads.Worker` used here (allows a fake in tests). */
export interface WorkerLike {
    postMessage(message: WorkerRequest): void;
    on(event: 'message', listener: (message: WorkerResponse) => void): unknown;
    on(event: 'error', listener: (error: Error) => void): unknown;
    on(event: 'exit', listener: (code: number) => void): unknown;
    terminate(): Promise<number>;
}

export type WorkerFactory = (workerPath: string) => WorkerLike;

const defaultFactory: WorkerFactory = (workerPath) =>
    new Worker(workerPath) as unknown as WorkerLike;

interface Pending {
    resolve(value: unknown): void;
    reject(error: Error): void;
    timer: NodeJS.Timeout;
}

const CONNECT_TIMEOUT_MS = 20_000;
const SCHEMA_TIMEOUT_MS = 45_000;
const DISCONNECT_TIMEOUT_MS = 3_000;
/** Extra time granted to the worker beyond the server-side statement timeout. */
const COUNT_GRACE_MS = 10_000;

/**
 * Owns the database worker thread and exposes a typed request/response API.
 * Each request has an id and its own timeout, so concurrent requests never
 * steal each other's results.
 */
export class ConnectionManager implements Disposable {
    private worker: WorkerLike | undefined;
    private readonly pending = new Map<number, Pending>();
    private nextId = 1;
    private generation = 0;
    private _state: ConnectionState = { status: 'disconnected' };
    private readonly stateEmitter = new Emitter<ConnectionState>();
    public readonly onDidChangeState = this.stateEmitter.event;

    constructor(
        private readonly workerPath: string,
        private readonly createWorker: WorkerFactory = defaultFactory
    ) {}

    public get state(): ConnectionState {
        return this._state;
    }

    public get isConnected(): boolean {
        return this._state.status === 'connected';
    }

    /**
     * Connects to a database, replacing any existing connection. A newer call
     * supersedes an in-flight one.
     */
    public async connect(
        profile: { id: string; name: string },
        payload: ConnectPayload
    ): Promise<ConnectResult> {
        const generation = ++this.generation;
        await this.shutdownWorker();
        // Another connect() may have started while we were awaiting: never spawn a
        // second worker (it would orphan the newer one).
        if (generation !== this.generation) {
            throw new QueryGuardError('Connection superseded by a newer request.', 'QG_SUPERSEDED');
        }
        this.setState({ status: 'connecting', profileId: profile.id, profileName: profile.name });

        try {
            this.worker = this.spawn(generation);
            const result = await this.request('connect', { payload }, CONNECT_TIMEOUT_MS);
            if (generation !== this.generation) {
                throw new QueryGuardError(
                    'Connection superseded by a newer request.',
                    'QG_SUPERSEDED'
                );
            }
            this.setState({
                status: 'connected',
                profileId: profile.id,
                profileName: profile.name,
                serverVersion: result.serverVersion,
            });
            return result;
        } catch (error) {
            if (generation === this.generation) {
                await this.shutdownWorker();
                this.setState({ status: 'disconnected' });
            }
            throw this.normalize(error);
        }
    }

    public async disconnect(): Promise<void> {
        this.generation++;
        if (this.worker) {
            try {
                await this.request('disconnect', {}, DISCONNECT_TIMEOUT_MS);
            } catch (error) {
                Logger.warn('Graceful disconnect failed; terminating worker.', error);
            }
        }
        await this.shutdownWorker();
        this.setState({ status: 'disconnected' });
    }

    public fetchSchema(): Promise<SchemaSnapshot> {
        return this.request('fetchSchema', {}, SCHEMA_TIMEOUT_MS).catch((e) => {
            throw this.normalize(e);
        });
    }

    /**
     * Runs read-only COUNT queries. If the worker does not answer in time (e.g.
     * the network hangs), the worker is killed and the state reset, so the
     * pool can't be left holding an open transaction.
     */
    public async count(request: CountRequest): Promise<CountResult> {
        // The worker enforces the budget server-side; this only catches a hung worker.
        const timeout = totalBudgetMs(request) + COUNT_GRACE_MS;
        try {
            return await this.request('count', { payload: request }, timeout);
        } catch (error) {
            const normalized = this.normalize(error);
            if (normalized.code === 'QG_TIMEOUT') {
                Logger.error('Simulation did not answer in time; restarting the database worker.');
                await this.shutdownWorker();
                this.setState({ status: 'disconnected' });
            }
            throw normalized;
        }
    }

    public dispose(): void {
        this.generation++;
        void this.shutdownWorker();
        this.stateEmitter.dispose();
    }

    // ------------------------------------------------------------------------

    private spawn(generation: number): WorkerLike {
        const worker = this.createWorker(this.workerPath);
        worker.on('message', (message: WorkerResponse) => this.onMessage(message));
        worker.on('error', (error: Error) => {
            Logger.error('Database worker crashed', error);
            this.rejectAll(
                new QueryGuardError(`Database worker crashed: ${error.message}`, 'QG_WORKER')
            );
        });
        worker.on('exit', (code: number) => {
            if (this.worker !== worker) return;
            this.worker = undefined;
            this.rejectAll(
                new QueryGuardError(`Database worker exited (code ${code}).`, 'QG_WORKER')
            );
            if (generation === this.generation && this._state.status !== 'disconnected') {
                this.setState({ status: 'disconnected' });
            }
        });
        return worker;
    }

    private onMessage(message: WorkerResponse): void {
        if (message.kind === 'log') {
            Logger[message.level](`[worker] ${message.message}`);
            return;
        }
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.ok) pending.resolve(message.result);
        else pending.reject(new QueryGuardError(message.error.message, message.error.code));
    }

    private request<K extends keyof WorkerResultMap>(
        type: K,
        body: Omit<Extract<WorkerRequest, { type: K }>, 'id' | 'type'>,
        timeoutMs: number
    ): Promise<WorkerResultMap[K]> {
        const worker = this.worker;
        if (!worker) {
            return Promise.reject(
                new QueryGuardError('Not connected to a database.', 'QG_NOT_CONNECTED')
            );
        }
        const id = this.nextId++;
        return new Promise<WorkerResultMap[K]>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(
                    new QueryGuardError(
                        `The database did not answer within ${Math.round(timeoutMs / 1000)}s.`,
                        'QG_TIMEOUT'
                    )
                );
            }, timeoutMs);
            this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
            worker.postMessage({ id, type, ...body } as WorkerRequest);
        });
    }

    private rejectAll(error: Error): void {
        for (const [id, pending] of this.pending) {
            clearTimeout(pending.timer);
            pending.reject(error);
            this.pending.delete(id);
        }
    }

    private async shutdownWorker(): Promise<void> {
        const worker = this.worker;
        this.worker = undefined;
        this.rejectAll(new QueryGuardError('Connection closed.', 'QG_CLOSED'));
        if (worker) {
            try {
                await worker.terminate();
            } catch (error) {
                Logger.warn('Failed to terminate database worker', error);
            }
        }
    }

    private setState(state: ConnectionState): void {
        this._state = state;
        this.stateEmitter.fire(state);
    }

    private normalize(error: unknown): QueryGuardError {
        if (error instanceof QueryGuardError) {
            return new QueryGuardError(friendlyError(error.message, error.code), error.code);
        }
        const message = error instanceof Error ? error.message : String(error);
        return new QueryGuardError(friendlyError(message));
    }
}
