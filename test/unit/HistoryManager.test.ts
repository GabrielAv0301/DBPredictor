/* eslint-disable @typescript-eslint/no-explicit-any */
import * as assert from 'assert';
import { HistoryManager } from '../../src/core/impact/HistoryManager';
import { ImpactResult } from '../../src/core/impact/types';
import * as vscodeMock from './vscode.mock';

describe('HistoryManager Unit Tests', () => {
    let mockContext: vscodeMock.ExtensionContext;
    let historyManager: HistoryManager;

    beforeEach(() => {
        const mockGlobalState = new vscodeMock.MockMemento();
        mockContext = {
            globalState: mockGlobalState,
            workspaceState: new vscodeMock.MockMemento(),
            secrets: new vscodeMock.MockSecretStorage(),
            extensionUri: vscodeMock.Uri.file('/test'),
            extensionPath: '/test',
            subscriptions: [],
        };
        historyManager = new HistoryManager(mockContext as any);
    });

    const mockImpact: ImpactResult = {
        table: 'users',
        operation: 'deleteMany',
        hasWhere: false,
        queryParams: [],
        baseRowsAffected: 100,
        totalRowsAffected: 100,
        tableTotalRows: 1000,
        estimationQuality: 'exact',
        riskLevel: 'DESTRUCTIVE',
        cascadeChain: [],
        willFailByRestrict: false,
    };

    const mockDocument = { fileName: 'test.ts' } as any;

    it('should save and retrieve history', () => {
        historyManager.save(mockImpact, mockDocument);
        const history = historyManager.getHistory();
        assert.strictEqual(history.length, 1);
        assert.strictEqual(history[0].impact.table, 'users');
        assert.strictEqual(history[0].fileName, 'test.ts');
    });

    it('should limit history to MAX_ENTRIES', () => {
        // We know MAX_ENTRIES is 20 from HistoryManager.ts
        for (let i = 0; i < 25; i++) {
            historyManager.save({ ...mockImpact, totalRowsAffected: i }, mockDocument);
        }
        const history = historyManager.getHistory();
        assert.strictEqual(history.length, 20);
        assert.strictEqual(history[0].impact.totalRowsAffected, 24); // Most recent first
    });

    it('should clear history', () => {
        historyManager.save(mockImpact, mockDocument);
        historyManager.clear();
        const history = historyManager.getHistory();
        assert.strictEqual(history.length, 0);
    });
});
