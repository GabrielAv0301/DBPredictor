import * as vscode from 'vscode';
import { Logger } from '../utils/logger';

export class SecretsManager {
    private static instance: SecretsManager;
    private readonly SECRET_KEY = 'queryguard.connectionString';

    private constructor(private readonly secrets: vscode.SecretStorage) {}

    public static init(context: vscode.ExtensionContext) {
        if (!this.instance) {
            this.instance = new SecretsManager(context.secrets);
        }
    }

    public static getInstance(): SecretsManager {
        if (!this.instance) {
            throw new Error('SecretsManager not initialized');
        }
        return this.instance;
    }

    public async saveConnectionString(connectionString: string): Promise<void> {
        try {
            await this.secrets.store(this.SECRET_KEY, connectionString);
            Logger.info('Connection string saved securely.');
        } catch (error) {
            Logger.error('Failed to save connection string', error);
            throw error;
        }
    }

    public async getConnectionString(): Promise<string | undefined> {
        try {
            return await this.secrets.get(this.SECRET_KEY);
        } catch (error) {
            Logger.error('Failed to retrieve connection string', error);
            return undefined;
        }
    }

    public async deleteConnectionString(): Promise<void> {
        try {
            await this.secrets.delete(this.SECRET_KEY);
            Logger.info('Connection string deleted.');
        } catch (error) {
            Logger.error('Failed to delete connection string', error);
        }
    }
}
