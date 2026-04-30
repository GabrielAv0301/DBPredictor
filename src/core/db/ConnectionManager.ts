import * as path from 'path';
import * as vscode from 'vscode';
import { Worker } from 'worker_threads';
import { Logger } from '../../utils/logger';
import { WorkerMessage, WorkerResponse, SchemaData, SqlParam } from './types';
import { SSLMode, getDefaultSSLMode } from '../../config/SSLConfig';

export class ConnectionManager {
    private static instance: ConnectionManager;
    public static readonly WorkerClass: typeof Worker = Worker;
    private worker: Worker | null = null;
    private isConnected: boolean = false;
    private isConnecting: boolean = false;
    private currentConnectionString: string | null = null;
    private onSchemaUpdate?: (data: SchemaData) => void;
    private onSimulationResult?: (rowCount: number, error?: string) => void;
    private onError?: (error: string) => void;
    private customWorkerPath: string | null = null;

    private constructor() {}

    public static getInstance(): ConnectionManager {
        if (!this.instance) {
            this.instance = new ConnectionManager();
        }
        return this.instance;
    }

    public setWorkerPath(workerPath: string) {
        this.customWorkerPath = workerPath;
    }

    public setOnSchemaUpdate(callback: ((data: SchemaData) => void) | undefined) {
        this.onSchemaUpdate = callback;
    }

    public setOnSimulationResult(
        callback: ((rowCount: number, error?: string) => void) | undefined
    ) {
        this.onSimulationResult = callback;
    }

    public setOnError(callback: ((error: string) => void) | undefined) {
        this.onError = callback;
    }

    public getIsConnected(): boolean {
        return this.isConnected;
    }

    /**
     * Determine SSL mode from VS Code configuration, with smart defaults.
     */
    private resolveSSLMode(connectionString: string): SSLMode {
        const config = vscode.workspace.getConfiguration('queryguard');
        const configured = config.get<string>('sslMode', 'auto');

        if (configured === 'auto') {
            return getDefaultSSLMode(connectionString);
        }

        switch (configured) {
            case 'disable':
                return SSLMode.DISABLE;
            case 'require':
                return SSLMode.REQUIRE;
            case 'verify-ca':
                return SSLMode.VERIFY_CA;
            case 'verify-full':
                return SSLMode.VERIFY_FULL;
            default:
                return getDefaultSSLMode(connectionString);
        }
    }

    public async connect(connectionString: string): Promise<{ success: boolean; error?: string }> {
        if (this.isConnecting) {
            Logger.warn('DB Connection: Already in progress. Ignoring duplicate request.');
            return { success: false, error: 'Connection already in progress.' };
        }

        this.isConnecting = true;
        this.currentConnectionString = connectionString;
        const sslMode = this.resolveSSLMode(connectionString);

        return new Promise((resolve) => {
            if (this.worker) {
                this.worker.terminate();
            }

            const workerPath =
                this.customWorkerPath || path.join(__dirname, 'workers', 'db.worker.js');
            Logger.info(`DB Connection: Starting worker at ${workerPath} (SSL mode: ${sslMode})`);

            try {
                const worker = new ConnectionManager.WorkerClass(workerPath);
                this.worker = worker;

                worker.on('message', (response: WorkerResponse) => {
                    switch (response.type) {
                        case 'CONNECTED':
                            this.isConnected = response.success;
                            this.isConnecting = false;
                            if (response.success) {
                                Logger.info('DB Worker: Connected successfully.');
                                this.querySchema();
                                resolve({ success: true });
                            } else {
                                const error = response.error || 'Unknown connection error';
                                Logger.error('DB Worker: Connection failed', error);
                                resolve({ success: false, error });
                            }
                            break;
                        case 'SCHEMA_DATA':
                            if (this.onSchemaUpdate) {
                                this.onSchemaUpdate(response.data);
                            }
                            break;
                        case 'SIMULATION_RESULT':
                            if (this.onSimulationResult) {
                                this.onSimulationResult(response.rowCount, response.error);
                            }
                            break;
                        case 'ERROR':
                            Logger.error('DB Worker error', response.error);
                            this.isConnected = false;
                            this.isConnecting = false;
                            if (this.onError) {
                                this.onError(response.error || 'Unknown error');
                            }
                            break;
                    }
                });

                worker.on('error', (err: Error) => {
                    Logger.error('Worker thread fatal error', err);
                    this.isConnected = false;
                    this.isConnecting = false;
                    const errorMessage = err.message || 'Worker thread fatal error';
                    if (this.onError) {
                        this.onError(errorMessage);
                    }
                    resolve({ success: false, error: errorMessage });
                });

                worker.postMessage({ type: 'CONNECT', connectionString, sslMode } as WorkerMessage);
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : String(err);
                Logger.error('Failed to create worker thread', errorMessage);
                this.isConnecting = false;
                resolve({ success: false, error: `Failed to initialize worker: ${errorMessage}` });
                return;
            }
        });
    }

    public async reconnect(): Promise<{ success: boolean; error?: string }> {
        if (this.currentConnectionString) {
            return this.connect(this.currentConnectionString);
        }
        return { success: false, error: 'No stored connection string to reconnect.' };
    }

    public querySchema() {
        if (this.worker && this.isConnected) {
            this.worker.postMessage({ type: 'QUERY_SCHEMA' } as WorkerMessage);
        }
    }

    public simulate(sql: string, params: SqlParam[] = []) {
        if (this.worker && this.isConnected) {
            this.worker.postMessage({ type: 'SIMULATE', sql, params } as WorkerMessage);
        }
    }

    public async disconnect() {
        if (this.worker) {
            return new Promise<void>((resolve) => {
                this.worker?.postMessage({ type: 'DISCONNECT' } as WorkerMessage);
                setTimeout(async () => {
                    await this.worker?.terminate();
                    this.worker = null;
                    this.isConnected = false;
                    Logger.info('DB Worker: Terminated gracefully.');
                    resolve();
                }, 200);
            });
        }
    }
}
