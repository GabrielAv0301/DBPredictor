import * as path from 'path';
import { Worker } from 'worker_threads';
import { Logger } from '../../utils/logger';
import { WorkerMessage, WorkerResponse, SchemaData, SqlParam } from './types';

export class ConnectionManager {
    private static instance: ConnectionManager;
    private worker: Worker | null = null;
    private isConnected: boolean = false;
    private isConnecting: boolean = false;
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

    public setOnSimulationResult(callback: ((rowCount: number, error?: string) => void) | undefined) {
        this.onSimulationResult = callback;
    }

    public setOnError(callback: ((error: string) => void) | undefined) {
        this.onError = callback;
    }

    public async connect(connectionString: string): Promise<boolean> {
        if (this.isConnecting) {
            Logger.warn('DB Connection: Already in progress. Ignoring duplicate request.');
            return false;
        }

        this.isConnecting = true;

        return new Promise((resolve) => {
            if (this.worker) {
                this.worker.terminate();
            }

            // Usar ruta personalizada o fallback
            const workerPath = this.customWorkerPath || path.join(__dirname, 'workers', 'db.worker.js');
            Logger.info(`DB Connection: Starting worker at ${workerPath}`);
            
            try {
                this.worker = new Worker(workerPath);
            } catch (err: any) {
                Logger.error('Failed to create worker thread', err);
                this.isConnecting = false;
                resolve(false);
                return;
            }

            // Manejo de mensajes desde el worker
            this.worker.on('message', (response: WorkerResponse) => {
                switch (response.type) {
                    case 'CONNECTED':
                        this.isConnected = response.success;
                        this.isConnecting = false;
                        if (response.success) {
                            Logger.info('DB Worker: Connected successfully.');
                            this.querySchema();
                        } else {
                            Logger.error('DB Worker: Connection failed', response.error);
                        }
                        resolve(response.success);
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

            this.worker.on('error', (err) => {
                Logger.error('Worker thread fatal error', err);
                this.isConnected = false;
                this.isConnecting = false;
                if (this.onError) {
                    this.onError(err.message);
                }
                resolve(false);
            });

            this.worker.postMessage({ type: 'CONNECT', connectionString } as WorkerMessage);
        });
    }

    // Solicitar esquema al worker
    public querySchema() {
        if (this.worker && this.isConnected) {
            this.worker.postMessage({ type: 'QUERY_SCHEMA' } as WorkerMessage);
        }
    }

    // Enviar consulta de simulación con parámetros
    public simulate(sql: string, params: SqlParam[] = []) {
        if (this.worker && this.isConnected) {
            this.worker.postMessage({ type: 'SIMULATE', sql, params } as WorkerMessage);
        }
    }

    // Desconexión limpia del worker y cierre del pool
    public async disconnect() {
        if (this.worker) {
            return new Promise<void>((resolve) => {
                this.worker?.postMessage({ type: 'DISCONNECT' } as WorkerMessage);
                // Damos un margen pequeño para que el pool cierre antes de matar el hilo
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

    public getIsConnected(): boolean {
        return this.isConnected;
    }
}
