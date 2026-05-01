import * as vscode from 'vscode';
import { Logger } from '../utils/logger';

export interface ConnectionProfile {
    name: string;
    connectionString: string;
    sslMode: string;
    createdAt: number;
}

const PROFILES_KEY = 'queryguard.connectionProfiles';

export class ConnectionProfileManager {
    private static readonly MAX_PROFILES = 10;

    public static async list(context: vscode.ExtensionContext): Promise<ConnectionProfile[]> {
        return context.globalState.get<ConnectionProfile[]>(PROFILES_KEY) || [];
    }

    public static async save(
        context: vscode.ExtensionContext,
        profile: ConnectionProfile
    ): Promise<void> {
        const profiles = await this.list(context);
        const existing = profiles.findIndex((p) => p.name === profile.name);
        if (existing >= 0) {
            profiles[existing] = profile;
        } else {
            if (profiles.length >= this.MAX_PROFILES) {
                throw new Error(`Maximum of ${this.MAX_PROFILES} connection profiles allowed.`);
            }
            profiles.push(profile);
        }
        await context.globalState.update(PROFILES_KEY, profiles);
        Logger.info(`Connection profile '${profile.name}' saved.`);
    }

    public static async delete(context: vscode.ExtensionContext, name: string): Promise<void> {
        const profiles = await this.list(context);
        const filtered = profiles.filter((p) => p.name !== name);
        await context.globalState.update(PROFILES_KEY, filtered);
        Logger.info(`Connection profile '${name}' deleted.`);
    }
}
