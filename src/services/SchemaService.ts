import { SchemaIndex } from '../core/schema/types';
import type { ConnectionManager } from '../db/ConnectionManager';
import { Emitter, type Disposable } from '../utils/events';
import { Logger } from '../utils/logger';

/**
 * Holds the schema snapshot of the connected database and refreshes it
 * periodically (`queryguard.cacheTTL`) and on demand.
 */
export class SchemaService implements Disposable {
    private _index: SchemaIndex | null = null;
    private inflight: Promise<SchemaIndex | null> | undefined;
    private timer: NodeJS.Timeout | undefined;
    private readonly emitter = new Emitter<SchemaIndex | null>();
    public readonly onDidChange = this.emitter.event;
    private readonly subscription: Disposable;

    constructor(
        private readonly connection: ConnectionManager,
        private readonly refreshIntervalSeconds: () => number
    ) {
        this.subscription = connection.onDidChangeState((state) => {
            if (state.status === 'connected') {
                this.refresh().catch((error) =>
                    Logger.error('Failed to load the database schema', error)
                );
                this.schedule();
            } else if (state.status === 'disconnected') {
                this.stopTimer();
                this.set(null);
            }
        });
    }

    public get index(): SchemaIndex | null {
        return this._index;
    }

    /** Fetches the schema; concurrent callers share the same request. */
    public refresh(): Promise<SchemaIndex | null> {
        if (!this.connection.isConnected) return Promise.resolve(this._index);
        if (this.inflight) return this.inflight;
        const started = Date.now();
        this.inflight = this.connection
            .fetchSchema()
            .then((snapshot) => {
                const index = new SchemaIndex(snapshot);
                Logger.info(
                    `Schema loaded: ${snapshot.tables.length} tables, ${snapshot.foreignKeys.length} foreign keys (${Date.now() - started} ms).`
                );
                if (this.connection.isConnected) this.set(index);
                return index;
            })
            .finally(() => {
                this.inflight = undefined;
            });
        return this.inflight;
    }

    /** Restarts the periodic refresh with the current interval setting. */
    public schedule(): void {
        this.stopTimer();
        const seconds = this.refreshIntervalSeconds();
        if (seconds <= 0 || !this.connection.isConnected) return;
        this.timer = setInterval(() => {
            this.refresh().catch((error) => Logger.warn('Background schema refresh failed', error));
        }, seconds * 1000);
        this.timer.unref?.();
    }

    public dispose(): void {
        this.stopTimer();
        this.subscription.dispose();
        this.emitter.dispose();
    }

    private set(index: SchemaIndex | null): void {
        this._index = index;
        this.emitter.fire(index);
    }

    private stopTimer(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
    }
}
