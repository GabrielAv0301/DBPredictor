import * as assert from 'assert';
import { CascadeAnalyzer } from '../../src/core/impact/CascadeAnalyzer';
import { SchemaData } from '../../src/core/db/types';

describe('CascadeAnalyzer Unit Tests', () => {
    // Mock de esquema de base de datos para pruebas
    const mockSchema: SchemaData = {
        tables: [
            { tableName: 'users', rowCount: 100 },
            { tableName: 'posts', rowCount: 500 },
            { tableName: 'comments', rowCount: 2000 },
            { tableName: 'profiles', rowCount: 100 }
        ],
        relationships: [
            { 
                tableName: 'posts', 
                columnName: 'authorId', 
                foreignTableName: 'users', 
                deleteRule: 'CASCADE' 
            },
            { 
                tableName: 'comments', 
                columnName: 'postId', 
                foreignTableName: 'posts', 
                deleteRule: 'CASCADE' 
            },
            { 
                tableName: 'profiles', 
                columnName: 'userId', 
                foreignTableName: 'users', 
                deleteRule: 'RESTRICT' 
            }
        ],
        timestamp: Date.now()
    };

    const analyzer = new CascadeAnalyzer(mockSchema);

    it('should return empty array for table with no outgoing relations', () => {
        const results = analyzer.analyze('comments', 1);
        assert.strictEqual(results.length, 0);
    });

    it('should detect direct CASCADE relation', () => {
        // posts -> comments (CASCADE)
        const results = analyzer.analyze('posts', 10); // Afectamos 10 posts
        
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].table, 'comments');
        assert.strictEqual(results[0].rule, 'CASCADE');
        // 10 posts afectarán proporcionalmente a los comments (500 posts : 2000 comments -> ratio 4)
        // 10 * 4 = 40
        assert.strictEqual(results[0].rowsEstimated, 40);
    });

    it('should detect nested CASCADE chain (A -> B -> C)', () => {
        // users -> posts -> comments
        const results = analyzer.analyze('users', 1);
        
        assert.strictEqual(results.length, 2); // posts y profiles
        const postsResult = results.find(r => r.table === 'posts');
        assert.ok(postsResult);
        assert.strictEqual(postsResult?.children.length, 1);
        assert.strictEqual(postsResult?.children[0].table, 'comments');
    });

    it('should identify RESTRICT violation', () => {
        // users -> profiles (RESTRICT)
        const results = analyzer.analyze('users', 1);
        const profilesResult = results.find(r => r.table === 'profiles');
        
        assert.strictEqual(profilesResult?.rule, 'RESTRICT');
    });

    it('should handle circular references without infinite loop', () => {
        const circularSchema: SchemaData = {
            tables: [
                { tableName: 'A', rowCount: 10 },
                { tableName: 'B', rowCount: 10 }
            ],
            relationships: [
                { tableName: 'B', columnName: 'aId', foreignTableName: 'A', deleteRule: 'CASCADE' },
                { tableName: 'A', columnName: 'bId', foreignTableName: 'B', deleteRule: 'CASCADE' }
            ],
            timestamp: Date.now()
        };
        const circularAnalyzer = new CascadeAnalyzer(circularSchema);
        
        // No debería lanzar error de stack overflow
        const results = circularAnalyzer.analyze('A', 1);
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].table, 'B');
        assert.strictEqual(results[0].children.length, 0); // No vuelve a procesar A
    });
});
