import * as assert from 'assert';
import { ConnectionProfileManager, ConnectionProfile } from '../../src/config/ConnectionProfile';
import * as vscodeMock from './vscode.mock';

const mockGlobalState = new vscodeMock.MockMemento();
const mockContext = {
    globalState: mockGlobalState,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

describe('ConnectionProfileManager Unit Tests', () => {
    beforeEach(() => {
        // Clear storage between tests
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const storage = (mockGlobalState as any).storage;
        storage.clear();
    });

    it('should list empty profiles initially', async () => {
        const profiles = await ConnectionProfileManager.list(mockContext);
        assert.deepStrictEqual(profiles, []);
    });

    it('should save a new profile', async () => {
        const profile: ConnectionProfile = {
            name: 'Test DB',
            connectionString: 'postgres://localhost/test',
            sslMode: 'auto',
            createdAt: Date.now(),
        };

        await ConnectionProfileManager.save(mockContext, profile);
        const profiles = await ConnectionProfileManager.list(mockContext);
        
        assert.strictEqual(profiles.length, 1);
        assert.strictEqual(profiles[0].name, 'Test DB');
    });

    it('should overwrite an existing profile with the same name', async () => {
        const profile1: ConnectionProfile = {
            name: 'Dev DB',
            connectionString: 'postgres://localhost/dev1',
            sslMode: 'auto',
            createdAt: Date.now(),
        };
        const profile2: ConnectionProfile = {
            name: 'Dev DB',
            connectionString: 'postgres://localhost/dev2',
            sslMode: 'require',
            createdAt: Date.now(),
        };

        await ConnectionProfileManager.save(mockContext, profile1);
        await ConnectionProfileManager.save(mockContext, profile2);
        
        const profiles = await ConnectionProfileManager.list(mockContext);
        assert.strictEqual(profiles.length, 1);
        assert.strictEqual(profiles[0].connectionString, 'postgres://localhost/dev2');
        assert.strictEqual(profiles[0].sslMode, 'require');
    });

    it('should enforce maximum profiles limit', async () => {
        for (let i = 0; i < 10; i++) {
            await ConnectionProfileManager.save(mockContext, {
                name: `DB ${i}`,
                connectionString: `postgres://localhost/db${i}`,
                sslMode: 'auto',
                createdAt: Date.now(),
            });
        }
        
        // 11th should throw
        await assert.rejects(
            ConnectionProfileManager.save(mockContext, {
                name: 'DB 11',
                connectionString: 'postgres://localhost/db11',
                sslMode: 'auto',
                createdAt: Date.now(),
            }),
            /Maximum of 10 connection profiles allowed/
        );
    });

    it('should delete a profile by name', async () => {
        const profile: ConnectionProfile = {
            name: 'To Delete',
            connectionString: 'postgres://localhost/test',
            sslMode: 'auto',
            createdAt: Date.now(),
        };

        await ConnectionProfileManager.save(mockContext, profile);
        await ConnectionProfileManager.delete(mockContext, 'To Delete');
        
        const profiles = await ConnectionProfileManager.list(mockContext);
        assert.strictEqual(profiles.length, 0);
    });
});
