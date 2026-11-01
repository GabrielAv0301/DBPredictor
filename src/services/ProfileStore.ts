import { randomUUID } from 'crypto';
import { describeConnection } from '../db/ssl';
import { Logger } from '../utils/logger';

/** Subset of `vscode.Memento`. */
export interface StateStore {
    get<T>(key: string): T | undefined;
    update(key: string, value: unknown): Thenable<void>;
}

/** Subset of `vscode.SecretStorage`. */
export interface SecretStore {
    get(key: string): Thenable<string | undefined>;
    store(key: string, value: string): Thenable<void>;
    delete(key: string): Thenable<void>;
}

export interface ConnectionProfile {
    id: string;
    name: string;
    /** `user@host:port/db` — never contains the password. */
    target: string;
    createdAt: number;
}

const PROFILES_KEY = 'queryguard.profiles.v2';
const ACTIVE_KEY = 'queryguard.activeProfileId';
const SECRET_PREFIX = 'queryguard.profile.';

// Keys used by versions ≤ 1.x
const LEGACY_PROFILES_KEY = 'queryguard.connectionProfiles';
const LEGACY_SECRET_KEY = 'queryguard.connectionString';
const LEGACY_HISTORY_KEY = 'queryguard.history';

export const MAX_PROFILES = 20;

interface LegacyProfile {
    name?: unknown;
    connectionString?: unknown;
    createdAt?: unknown;
}

/**
 * Connection profiles. Metadata lives in global state; the connection string
 * (which contains the password) only ever lives in SecretStorage, which is
 * backed by the OS keychain.
 *
 * The active profile is remembered per workspace so that opening another
 * project never silently connects to the wrong database.
 */
export class ProfileStore {
    constructor(
        private readonly global: StateStore,
        private readonly workspace: StateStore,
        private readonly secrets: SecretStore
    ) {}

    public list(): ConnectionProfile[] {
        const value = this.global.get<ConnectionProfile[]>(PROFILES_KEY);
        return Array.isArray(value) ? value.filter((p) => p && typeof p.id === 'string') : [];
    }

    public get(id: string): ConnectionProfile | undefined {
        return this.list().find((p) => p.id === id);
    }

    public async create(name: string, connectionString: string): Promise<ConnectionProfile> {
        const profiles = this.list();
        const trimmed = name.trim();
        if (!trimmed) throw new Error('The profile name cannot be empty.');
        if (profiles.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
            throw new Error(`A profile named "${trimmed}" already exists.`);
        }
        if (profiles.length >= MAX_PROFILES) {
            throw new Error(`You can store up to ${MAX_PROFILES} profiles. Delete one first.`);
        }
        const profile: ConnectionProfile = {
            id: randomUUID(),
            name: trimmed,
            target: describeConnection(connectionString),
            createdAt: Date.now(),
        };
        // Store the secret first: a profile without its secret would be useless.
        await this.secrets.store(SECRET_PREFIX + profile.id, connectionString);
        await this.global.update(PROFILES_KEY, [...profiles, profile]);
        return profile;
    }

    public async delete(id: string): Promise<void> {
        await this.global.update(
            PROFILES_KEY,
            this.list().filter((p) => p.id !== id)
        );
        await this.secrets.delete(SECRET_PREFIX + id);
        if (this.activeId === id) await this.setActive(undefined);
    }

    public getConnectionString(id: string): Thenable<string | undefined> {
        return this.secrets.get(SECRET_PREFIX + id);
    }

    public get activeId(): string | undefined {
        return this.workspace.get<string>(ACTIVE_KEY);
    }

    public async setActive(id: string | undefined): Promise<void> {
        await this.workspace.update(ACTIVE_KEY, id);
    }

    /**
     * Migrates data written by QueryGuard ≤ 1.x, which kept full connection
     * strings (with passwords) in plain-text global state.
     */
    public async migrateLegacy(): Promise<number> {
        let migrated = 0;
        const legacy = this.global.get<LegacyProfile[]>(LEGACY_PROFILES_KEY);
        const legacyActive = await this.secrets.get(LEGACY_SECRET_KEY);

        if (Array.isArray(legacy)) {
            for (const item of legacy) {
                if (typeof item?.connectionString !== 'string') continue;
                const baseName =
                    typeof item.name === 'string' && item.name.trim()
                        ? item.name.trim()
                        : 'Imported';
                try {
                    const profile = await this.create(
                        this.uniqueName(baseName),
                        item.connectionString
                    );
                    migrated++;
                    if (legacyActive && legacyActive === item.connectionString && !this.activeId) {
                        await this.setActive(profile.id);
                    }
                } catch (error) {
                    Logger.warn('Could not migrate a legacy profile', error);
                }
            }
        }

        if (legacyActive && !this.activeId) {
            const existing = await this.findByConnectionString(legacyActive);
            if (existing) {
                await this.setActive(existing.id);
            } else {
                try {
                    const profile = await this.create(this.uniqueName('Default'), legacyActive);
                    await this.setActive(profile.id);
                    migrated++;
                } catch (error) {
                    Logger.warn('Could not migrate the legacy active connection', error);
                }
            }
        }

        // Remove plain-text credentials and stale data in every case.
        if (legacy !== undefined) await this.global.update(LEGACY_PROFILES_KEY, undefined);
        if (legacyActive !== undefined) await this.secrets.delete(LEGACY_SECRET_KEY);
        if (this.global.get(LEGACY_HISTORY_KEY) !== undefined) {
            await this.global.update(LEGACY_HISTORY_KEY, undefined);
        }
        return migrated;
    }

    private async findByConnectionString(value: string): Promise<ConnectionProfile | undefined> {
        for (const profile of this.list()) {
            if ((await this.getConnectionString(profile.id)) === value) return profile;
        }
        return undefined;
    }

    private uniqueName(base: string): string {
        const names = new Set(this.list().map((p) => p.name.toLowerCase()));
        if (!names.has(base.toLowerCase())) return base;
        for (let i = 2; ; i++) {
            const candidate = `${base} (${i})`;
            if (!names.has(candidate.toLowerCase())) return candidate;
        }
    }
}
