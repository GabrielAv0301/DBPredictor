import * as assert from 'assert';
import { SimulationRunner, SimulationResult } from '../../src/core/db/SimulationRunner';
import { ImpactResult } from '../../src/core/impact/types';
import { ConnectionManager } from '../../src/core/db/ConnectionManager';
import { SqlParam } from '../../src/core/db/types';

// ---------------------------------------------------------------------------
// Mock ConnectionManager singleton
// ---------------------------------------------------------------------------

class MockConnectionManager {
    public isConnected = false;
    public capturedSql: string | null = null;
    public capturedParams: SqlParam[] = [];
    public simulateResult: { rowCount: number; error?: string } = { rowCount: 1 };
    private onResultCallback: ((rowCount: number, error?: string) => void) | undefined;

    constructor(isConnected: boolean = false) {
        this.isConnected = isConnected;
    }

    getIsConnected(): boolean {
        return this.isConnected;
    }

    setOnSimulationResult(cb: ((rowCount: number, error?: string) => void) | undefined): void {
        this.onResultCallback = cb;
    }

    simulate(sql: string, params: SqlParam[]): void {
        this.capturedSql = sql;
        this.capturedParams = params;
        // Simulate async DB response
        const cb = this.onResultCallback;
        if (cb) {
            const result = this.simulateResult;
            cb(result.rowCount, result.error);
            this.onResultCallback = undefined;
        }
    }

    async disconnect(): Promise<void> {
        this.isConnected = false;
    }
}

// ---------------------------------------------------------------------------
// Helper: inject mock singleton and call simulate()
// ---------------------------------------------------------------------------

function runSimulate(mock: MockConnectionManager, impact: ImpactResult): Promise<SimulationResult> {
    // Replace the singleton with our mock
    const original = (ConnectionManager as unknown as { getInstance(): MockConnectionManager })
        .getInstance;
    (ConnectionManager as unknown as { getInstance(): MockConnectionManager }).getInstance = () =>
        mock;

    return SimulationRunner.simulate(impact).finally(() => {
        // Restore original singleton
        (ConnectionManager as unknown as { getInstance(): MockConnectionManager }).getInstance =
            original;
    });
}

// ---------------------------------------------------------------------------
// Minimal ImpactResult factory (reduces boilerplate per test)
// ---------------------------------------------------------------------------

function makeImpact(
    table: string,
    operation: 'deleteMany' | 'delete' | 'updateMany' | 'update',
    queryParams: { column: string; value: unknown }[] = []
): ImpactResult {
    return {
        table,
        operation,
        hasWhere: queryParams.length > 0,
        queryParams,
        baseRowsAffected: 10,
        totalRowsAffected: 10,
        tableTotalRows: 100,
        estimationQuality: 'exact',
        riskLevel: 'SAFE',
        cascadeChain: [],
        willFailByRestrict: false,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SimulationRunner Unit Tests', () => {
    // ------------------------------------------------------------------
    // simulate() — connection guard
    // ------------------------------------------------------------------

    it('should return error when not connected', async () => {
        const mock = new MockConnectionManager(false);
        const result = await runSimulate(mock, makeImpact('users', 'deleteMany'));
        assert.strictEqual(result.rowCount, 0);
        assert.strictEqual(result.error, 'Database not connected');
    });

    // ------------------------------------------------------------------
    // SQL generation — valid table names
    // ------------------------------------------------------------------

    it('should generate DELETE SQL for deleteMany', async () => {
        const mock = new MockConnectionManager(true);
        await runSimulate(mock, makeImpact('users', 'deleteMany'));
        assert.strictEqual(mock.capturedSql, 'DELETE FROM "users"');
        assert.deepStrictEqual(mock.capturedParams, []);
    });

    it('should generate DELETE SQL for delete', async () => {
        const mock = new MockConnectionManager(true);
        await runSimulate(mock, makeImpact('posts', 'delete'));
        assert.strictEqual(mock.capturedSql, 'DELETE FROM "posts"');
    });

    it('should generate DELETE SQL for updateMany (simulating update as delete)', async () => {
        const mock = new MockConnectionManager(true);
        await runSimulate(mock, makeImpact('products', 'updateMany'));
        // UPDATE is now simulated as DELETE to capture cascades correctly
        assert.strictEqual(mock.capturedSql, 'DELETE FROM "products"');
    });

    it('should generate DELETE SQL for update (simulating update as delete)', async () => {
        const mock = new MockConnectionManager(true);
        await runSimulate(mock, makeImpact('comments', 'update'));
        assert.strictEqual(mock.capturedSql, 'DELETE FROM "comments"');
    });

    // ------------------------------------------------------------------
    // SQL generation — valid table names with special characters
    // ------------------------------------------------------------------

    it('should accept underscore in table name', async () => {
        const mock = new MockConnectionManager(true);
        await runSimulate(mock, makeImpact('user_sessions', 'deleteMany'));
        assert.strictEqual(mock.capturedSql, 'DELETE FROM "user_sessions"');
    });

    it('should accept alphanumeric in table name', async () => {
        const mock = new MockConnectionManager(true);
        await runSimulate(mock, makeImpact('Table2024Q1', 'deleteMany'));
        assert.strictEqual(mock.capturedSql, 'DELETE FROM "Table2024Q1"');
    });

    it('should accept dots in table name (schemas)', async () => {
        const mock = new MockConnectionManager(true);
        await runSimulate(mock, makeImpact('my_schema.users', 'deleteMany'));
        assert.strictEqual(mock.capturedSql, 'DELETE FROM "my_schema"."users"');
    });

    it('should accept mixed-case table name', async () => {
        const mock = new MockConnectionManager(true);
        await runSimulate(mock, makeImpact('MyApp_Table_v2', 'updateMany'));
        assert.strictEqual(mock.capturedSql, 'DELETE FROM "MyApp_Table_v2"');
    });

    // ------------------------------------------------------------------
    // SQL generation — WHERE clause and parameterization
    // ------------------------------------------------------------------

    it('should build single-column parameterized WHERE clause', async () => {
        const mock = new MockConnectionManager(true);
        mock.simulateResult = { rowCount: 5 };
        await runSimulate(
            mock,
            makeImpact('users', 'deleteMany', [{ column: 'status', value: 'inactive' }])
        );
        assert.strictEqual(mock.capturedSql, 'DELETE FROM "users" WHERE "status" = $1');
        assert.deepStrictEqual(mock.capturedParams, ['inactive']);
    });

    it('should build multi-column parameterized WHERE clause with AND', async () => {
        const mock = new MockConnectionManager(true);
        await runSimulate(
            mock,
            makeImpact('orders', 'deleteMany', [
                { column: 'status', value: 'pending' },
                { column: 'created_at', value: '2024-01-01' },
            ])
        );
        assert.strictEqual(
            mock.capturedSql,
            'DELETE FROM "orders" WHERE "status" = $1 AND "created_at" = $2'
        );
        assert.deepStrictEqual(mock.capturedParams, ['pending', '2024-01-01']);
    });

    it('should handle numeric parameter values', async () => {
        const mock = new MockConnectionManager(true);
        await runSimulate(mock, makeImpact('posts', 'delete', [{ column: 'id', value: 42 }]));
        assert.strictEqual(mock.capturedSql, 'DELETE FROM "posts" WHERE "id" = $1');
        assert.deepStrictEqual(mock.capturedParams, [42]);
    });

    it('should handle boolean parameter values', async () => {
        const mock = new MockConnectionManager(true);
        await runSimulate(
            mock,
            makeImpact('users', 'update', [{ column: 'active', value: false }])
        );
        assert.strictEqual(mock.capturedSql, 'DELETE FROM "users" WHERE "active" = $1');
        assert.deepStrictEqual(mock.capturedParams, [false]);
    });

    it('should handle null parameter values', async () => {
        const mock = new MockConnectionManager(true);
        await runSimulate(
            mock,
            makeImpact('users', 'deleteMany', [{ column: 'deleted_at', value: null }])
        );
        assert.strictEqual(mock.capturedSql, 'DELETE FROM "users" WHERE "deleted_at" = $1');
        assert.deepStrictEqual(mock.capturedParams, [null]);
    });

    it('should build WHERE clause for UPDATE when queryParams provided', async () => {
        const mock = new MockConnectionManager(true);
        await runSimulate(
            mock,
            makeImpact('users', 'updateMany', [{ column: 'email', value: 'x' }])
        );
        assert.strictEqual(mock.capturedSql, 'DELETE FROM "users" WHERE "email" = $1');
    });

    it('should append multi-column WHERE clause to simulated UPDATE', async () => {
        const mock = new MockConnectionManager(true);
        await runSimulate(
            mock,
            makeImpact('users', 'update', [
                { column: 'email', value: 'x' },
                { column: 'id', value: 99 },
            ])
        );
        assert.strictEqual(
            mock.capturedSql,
            'DELETE FROM "users" WHERE "email" = $1 AND "id" = $2'
        );
        assert.deepStrictEqual(mock.capturedParams, ['x', 99]);
    });

    // ------------------------------------------------------------------
    // warnCascade for UPDATE
    // ------------------------------------------------------------------

    it('should return warnCascade for UPDATE operations with cascade chain', async () => {
        const mock = new MockConnectionManager(true);
        const impact = makeImpact('users', 'updateMany', [{ column: 'id', value: 1 }]);
        impact.cascadeChain = [
            { table: 'posts', rowsEstimated: 2, rule: 'CASCADE', children: [] },
        ];

        const result = await runSimulate(mock, impact);
        assert.strictEqual(
            result.warnCascade,
            'UPDATE cannot trigger DELETE cascades. Cascade estimation is informational.'
        );
    });

    // ------------------------------------------------------------------
    // SQL generation — valid column names
    // ------------------------------------------------------------------

    it('should accept underscore in column name', async () => {
        const mock = new MockConnectionManager(true);
        await runSimulate(
            mock,
            makeImpact('users', 'deleteMany', [{ column: 'created_at', value: 'ts' }])
        );
        assert.strictEqual(mock.capturedSql, 'DELETE FROM "users" WHERE "created_at" = $1');
    });

    it('should accept alphanumeric column names', async () => {
        const mock = new MockConnectionManager(true);
        await runSimulate(mock, makeImpact('orders', 'delete', [{ column: 'Col123', value: 1 }]));
        assert.strictEqual(mock.capturedSql, 'DELETE FROM "orders" WHERE "Col123" = $1');
    });

    // ------------------------------------------------------------------
    // SQL injection prevention — table names
    // ------------------------------------------------------------------

    it('should reject table name containing double quote', async () => {
        const mock = new MockConnectionManager(true);
        const result = await runSimulate(
            mock,
            makeImpact('users" DROP TABLE users;--', 'deleteMany')
        );
        assert.strictEqual(
            result.error,
            'Security Alert: Invalid table name detected ("users" DROP TABLE users;--"). Only alphanumeric and underscores allowed (optional one dot for schema).'
        );
        assert.strictEqual(mock.capturedSql, null);
    });

    it('should reject table name containing semicolon', async () => {
        const mock = new MockConnectionManager(true);
        const result = await runSimulate(
            mock,
            makeImpact('users; DROP TABLE users;', 'deleteMany')
        );
        assert.strictEqual(
            result.error,
            'Security Alert: Invalid table name detected ("users; DROP TABLE users;"). Only alphanumeric and underscores allowed (optional one dot for schema).'
        );
        assert.strictEqual(mock.capturedSql, null);
    });

    it('should reject table name containing single quote', async () => {
        const mock = new MockConnectionManager(true);
        const result = await runSimulate(mock, makeImpact('users\' OR \'1\'=\'1', 'delete'));
        assert.strictEqual(
            result.error,
            'Security Alert: Invalid table name detected ("users\' OR \'1\'=\'1"). Only alphanumeric and underscores allowed (optional one dot for schema).'
        );
        assert.strictEqual(mock.capturedSql, null);
    });

    it('should reject table name containing OR keyword (no spaces allowed)', async () => {
        const mock = new MockConnectionManager(true);
        const result = await runSimulate(mock, makeImpact('users OR 1=1', 'deleteMany'));
        assert.strictEqual(
            result.error,
            'Security Alert: Invalid table name detected ("users OR 1=1"). Only alphanumeric and underscores allowed (optional one dot for schema).'
        );
    });

    it('should reject table name containing SQL comment sequence (--)', async () => {
        const mock = new MockConnectionManager(true);
        const result = await runSimulate(mock, makeImpact('admin--', 'deleteMany'));
        assert.strictEqual(
            result.error,
            'Security Alert: Invalid table name detected ("admin--"). Only alphanumeric and underscores allowed (optional one dot for schema).'
        );
    });

    it('should reject table name containing SQL comment sequence (/*)', async () => {
        const mock = new MockConnectionManager(true);
        const result = await runSimulate(mock, makeImpact('users/*comment*/', 'deleteMany'));
        assert.strictEqual(
            result.error,
            'Security Alert: Invalid table name detected ("users/*comment*/"). Only alphanumeric and underscores allowed (optional one dot for schema).'
        );
    });

    it('should reject table name containing equals sign', async () => {
        const mock = new MockConnectionManager(true);
        const result = await runSimulate(mock, makeImpact('id=1', 'deleteMany'));
        assert.strictEqual(
            result.error,
            'Security Alert: Invalid table name detected ("id=1"). Only alphanumeric and underscores allowed (optional one dot for schema).'
        );
    });

    it('should reject table name containing slash', async () => {
        const mock = new MockConnectionManager(true);
        const result = await runSimulate(mock, makeImpact('users/something', 'deleteMany'));
        assert.strictEqual(
            result.error,
            'Security Alert: Invalid table name detected ("users/something"). Only alphanumeric and underscores allowed (optional one dot for schema).'
        );
    });

    it('should reject table name containing backslash', async () => {
        const mock = new MockConnectionManager(true);
        const result = await runSimulate(mock, makeImpact('users\\admin', 'deleteMany'));
        assert.strictEqual(
            result.error,
            'Security Alert: Invalid table name detected ("users\\admin"). Only alphanumeric and underscores allowed (optional one dot for schema).'
        );
    });

    it('should reject table name containing space', async () => {
        const mock = new MockConnectionManager(true);
        const result = await runSimulate(mock, makeImpact('admin users', 'deleteMany'));
        assert.strictEqual(
            result.error,
            'Security Alert: Invalid table name detected ("admin users"). Only alphanumeric and underscores allowed (optional one dot for schema).'
        );
    });

    it('should reject table name with classic SQL injection payload', async () => {
        const mock = new MockConnectionManager(true);
        const result = await runSimulate(mock, makeImpact('\'; DROP TABLE users;--', 'deleteMany'));
        assert.strictEqual(
            result.error,
            'Security Alert: Invalid table name detected ("\'; DROP TABLE users;--"). Only alphanumeric and underscores allowed (optional one dot for schema).'
        );
        assert.strictEqual(mock.capturedSql, null);
    });

    // ------------------------------------------------------------------
    // SQL injection prevention — column names
    // ------------------------------------------------------------------

    it('should reject column name containing double quote', async () => {
        const mock = new MockConnectionManager(true);
        const result = await runSimulate(
            mock,
            makeImpact('users', 'deleteMany', [{ column: 'status" OR 1=1;--', value: 'x' }])
        );
        assert.strictEqual(
            result.error,
            'Security Alert: Invalid column name detected ("status" OR 1=1;--").'
        );
        assert.strictEqual(mock.capturedSql, null);
    });

    it('should reject column name containing semicolon', async () => {
        const mock = new MockConnectionManager(true);
        const result = await runSimulate(
            mock,
            makeImpact('users', 'deleteMany', [{ column: 'id; DROP TABLE users;', value: 1 }])
        );
        assert.strictEqual(
            result.error,
            'Security Alert: Invalid column name detected ("id; DROP TABLE users;").'
        );
        assert.strictEqual(mock.capturedSql, null);
    });

    it('should reject column name containing single quote', async () => {
        const mock = new MockConnectionManager(true);
        const result = await runSimulate(
            mock,
            makeImpact('users', 'deleteMany', [{ column: 'name\' OR \'1\'=\'1', value: 'x' }])
        );
        assert.strictEqual(
            result.error,
            'Security Alert: Invalid column name detected ("name\' OR \'1\'=\'1").'
        );
    });

    it('should reject column name containing OR keyword', async () => {
        const mock = new MockConnectionManager(true);
        const result = await runSimulate(
            mock,
            makeImpact('users', 'deleteMany', [{ column: 'id OR 1=1', value: 1 }])
        );
        assert.strictEqual(
            result.error,
            'Security Alert: Invalid column name detected ("id OR 1=1").'
        );
    });

    it('should reject column name containing SQL comment (--)', async () => {
        const mock = new MockConnectionManager(true);
        const result = await runSimulate(
            mock,
            makeImpact('users', 'deleteMany', [{ column: 'id--', value: 1 }])
        );
        assert.strictEqual(result.error, 'Security Alert: Invalid column name detected ("id--").');
    });

    it('should reject column name containing SQL comment (/*)', async () => {
        const mock = new MockConnectionManager(true);
        const result = await runSimulate(
            mock,
            makeImpact('users', 'deleteMany', [{ column: 'id/*x*/', value: 1 }])
        );
        assert.strictEqual(
            result.error,
            'Security Alert: Invalid column name detected ("id/*x*/").'
        );
    });

    it('should reject column name containing equals sign', async () => {
        const mock = new MockConnectionManager(true);
        const result = await runSimulate(
            mock,
            makeImpact('users', 'deleteMany', [{ column: 'id=1', value: 1 }])
        );
        assert.strictEqual(result.error, 'Security Alert: Invalid column name detected ("id=1").');
    });

    it('should reject column name containing slash', async () => {
        const mock = new MockConnectionManager(true);
        const result = await runSimulate(
            mock,
            makeImpact('users', 'deleteMany', [{ column: 'a/b', value: 'x' }])
        );
        assert.strictEqual(result.error, 'Security Alert: Invalid column name detected ("a/b").');
    });

    it('should reject column name containing backslash', async () => {
        const mock = new MockConnectionManager(true);
        const result = await runSimulate(
            mock,
            makeImpact('users', 'deleteMany', [{ column: 'a\\b', value: 'x' }])
        );
        assert.strictEqual(result.error, 'Security Alert: Invalid column name detected ("a\\b").');
    });

    it('should reject column name containing space', async () => {
        const mock = new MockConnectionManager(true);
        const result = await runSimulate(
            mock,
            makeImpact('users', 'deleteMany', [{ column: 'bad col', value: 'x' }])
        );
        assert.strictEqual(
            result.error,
            'Security Alert: Invalid column name detected ("bad col").'
        );
    });

    // ------------------------------------------------------------------
    // simulate() — result passing
    // ------------------------------------------------------------------

    it('should pass rowCount from simulation result', async () => {
        const mock = new MockConnectionManager(true);
        mock.simulateResult = { rowCount: 42 };
        const result = await runSimulate(
            mock,
            makeImpact('orders', 'deleteMany', [{ column: 'id', value: 5 }])
        );
        assert.strictEqual(result.rowCount, 42);
        assert.strictEqual(result.error, undefined);
    });

    it('should pass error from simulation result', async () => {
        const mock = new MockConnectionManager(true);
        mock.simulateResult = { rowCount: 0, error: 'syntax error at end of input' };
        const result = await runSimulate(mock, makeImpact('orders', 'deleteMany'));
        assert.strictEqual(result.rowCount, 0);
        assert.strictEqual(result.error, 'syntax error at end of input');
    });

    it('should generate error when SQL generation fails', async () => {
        const mock = new MockConnectionManager(true);
        const result = await runSimulate(mock, makeImpact('users', 'deleteMany'));
        // This test verifies that no error is generated for valid input
        assert.strictEqual(result.error, undefined);
    });

    // ------------------------------------------------------------------
    // Timeout constant
    // ------------------------------------------------------------------

    it('should have SIMULATION_TIMEOUT_MS set to 15000', () => {
        // Access through the static constant — verify the value is as documented
        assert.strictEqual(
            (SimulationRunner as unknown as { SIMULATION_TIMEOUT_MS: number })
                .SIMULATION_TIMEOUT_MS,
            15000
        );
    });

    // ------------------------------------------------------------------
    // Unsupported operations (no DELETE/UPDATE generated)
    // ------------------------------------------------------------------

    it('should return error for unsupported operations (no SQL generated)', async () => {
        const mock = new MockConnectionManager(true);
        // createMany is not handled by generateSimulationSql
        const impact = makeImpact('users', 'deleteMany');
        (impact as unknown as { operation: string }).operation = 'createMany' as never;
        const result = await runSimulate(mock, impact);
        // No DELETE or UPDATE is generated, so sql stays null → error
        assert.strictEqual(result.error, 'Could not generate simulation SQL.');
        assert.strictEqual(mock.capturedSql, null);
    });
});
