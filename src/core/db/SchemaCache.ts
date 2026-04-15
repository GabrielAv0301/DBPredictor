import * as vscode from 'vscode';
import { SchemaData } from './types';
import { Logger } from '../../utils/logger';
import { ConnectionManager } from './ConnectionManager';

export class SchemaCache {
    private static instance: SchemaCache;
    private data: SchemaData | null = null;
    private isRefreshing: boolean = false;

    private get TTL_MS(): number {
        const config = vscode.workspace.getConfiguration('queryguard');
        const seconds = config.get<number>('cacheTTL', 300);
        return seconds * 1000;
    }

    private constructor() {}

    public static getInstance(): SchemaCache {
        if (!this.instance) {
            this.instance = new SchemaCache();
        }
        return this.instance;
    }

    public update(newData: SchemaData) {
        this.data = newData;
        this.isRefreshing = false;
        Logger.info('Schema cache updated', { 
            tables: newData.tables.length, 
            relations: newData.relationships.length 
        });
    }

    public getData(): SchemaData | null {
        if (!this.data) return null;

        const isExpired = Date.now() - this.data.timestamp > this.TTL_MS;
        if (isExpired && !this.isRefreshing) {
            Logger.warn('Schema cache expired. Triggering background refresh...');
            this.isRefreshing = true;
            
            const conn = ConnectionManager.getInstance();
            if (conn.getIsConnected()) {
                conn.querySchema();
            } else {
                this.isRefreshing = false;
            }
        }

        // Stale-while-revalidate: return old data while refreshing
        return this.data;
    }

    public clear() {
        this.data = null;
        this.isRefreshing = false;
    }
}
