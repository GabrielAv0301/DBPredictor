import * as assert from 'assert';
import { ImpactEngine } from '../../src/core/impact/ImpactEngine';
import { MutationInfo } from '../../src/core/detectors/DetectorInterface';
import { SchemaData } from '../../src/core/db/types';
import * as vscode from 'vscode';

describe('ImpactEngine Unit Tests', () => {
    const mockSchema: SchemaData = {
        tables: [
            { tableName: 'users', rowCount: 1000 },
            { tableName: 'sessions', rowCount: 5000 }
        ],
        relationships: [
            {
                tableName: 'sessions',
                columnName: 'userId',
                foreignTableName: 'users',
                deleteRule: 'CASCADE'
            }
        ],
        timestamp: Date.now()
    };

    it('Should classify as DESTRUCTIVE when deleteMany has no WHERE clause', () => {
        const mutation: MutationInfo = {
            table: 'users',
            operation: 'deleteMany',
            hasWhere: false,
            range: new vscode.Range(0, 0, 0, 0),
            sourceText: 'prisma.user.deleteMany({})'
        };

        const result = ImpactEngine.calculate(mutation, mockSchema);
        assert.strictEqual(result.riskLevel, 'DESTRUCTIVE');
        assert.strictEqual(result.baseRowsAffected, 1000);
    });

    it('Should classify as WARNING when mutation has WHERE clause', () => {
        const mutation: MutationInfo = {
            table: 'users',
            operation: 'deleteMany',
            hasWhere: true,
            range: new vscode.Range(0, 0, 0, 0),
            sourceText: 'prisma.user.deleteMany({ where: { id: 1 } })'
        };

        const result = ImpactEngine.calculate(mutation, mockSchema);
        assert.strictEqual(result.riskLevel, 'WARNING');
        assert.strictEqual(result.baseRowsAffected, 1000); // worst-case
        assert.strictEqual(result.estimationQuality, 'worst-case');
    });

    it('Should classify single delete as SAFE', () => {
        const mutation: MutationInfo = {
            table: 'users',
            operation: 'delete',         // Single record
            hasWhere: true,
            range: new vscode.Range(0, 0, 0, 0),
            sourceText: 'prisma.user.delete({ where: { id: 1 } })'
        };

        const result = ImpactEngine.calculate(mutation, mockSchema);
        assert.strictEqual(result.riskLevel, 'SAFE');
        assert.strictEqual(result.baseRowsAffected, 1);
        assert.strictEqual(result.estimationQuality, 'exact');
    });

    it('Should detect RESTRICT violations', () => {
        const restrictSchema: SchemaData = {
            tables: [{ tableName: 'users', rowCount: 100 }, { tableName: 'orders', rowCount: 50 }],
            relationships: [{
                tableName: 'orders',
                columnName: 'userId',
                foreignTableName: 'users',
                deleteRule: 'RESTRICT'
            }],
            timestamp: Date.now()
        };

        const mutation: MutationInfo = {
            table: 'users',
            operation: 'deleteMany',
            hasWhere: false,
            range: new vscode.Range(0, 0, 0, 0),
            sourceText: 'prisma.user.deleteMany({})'
        };

        const result = ImpactEngine.calculate(mutation, restrictSchema);
        assert.strictEqual(result.willFailByRestrict, true);
    });
});
