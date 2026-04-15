import * as assert from 'assert';
import * as vscode from 'vscode';
import { PrismaDetector } from '../../src/core/detectors/PrismaDetector';

// Mock simple de TextDocument para testing
class MockDocument {
    constructor(private content: string, public fileName: string = 'test.ts') {}
    getText() { return this.content; }
    positionAt(offset: number) {
        const lines = this.content.substring(0, offset).split('\n');
        return new vscode.Position(lines.length - 1, lines[lines.length - 1].length);
    }
    uri = { toString: () => 'file://' + this.fileName };
}

describe('PrismaDetector Unit Tests', () => {
    const detector = new PrismaDetector();

    it('should detect simple deleteMany without where', () => {
        const code = `await prisma.user.deleteMany({});`;
        const doc = new MockDocument(code) as any as vscode.TextDocument;
        const results = detector.detect(doc);

        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].table, 'user');
        assert.strictEqual(results[0].operation, 'deleteMany');
        assert.strictEqual(results[0].hasWhere, false);
    });

    it('should detect updateMany with literal where filters', () => {
        const code = `await prisma.post.updateMany({ 
            where: { published: false, authorId: 1 } 
        });`;
        const doc = new MockDocument(code) as any as vscode.TextDocument;
        const results = detector.detect(doc);

        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].table, 'post');
        assert.strictEqual(results[0].hasWhere, true);
        
        // Verificamos parámetros en lugar de string concatenado
        const params = results[0].queryParams || [];
        assert.ok(params.some(p => p.column === 'published' && p.value === false));
        assert.ok(params.some(p => p.column === 'authorId' && p.value === 1));
    });

    it('should detect mutations inside $transaction block', () => {
        const code = `
            await prisma.$transaction([
                prisma.log.deleteMany({ where: { level: 'INFO' } }),
                prisma.session.deleteMany({})
            ]);
        `;
        const doc = new MockDocument(code) as any as vscode.TextDocument;
        const results = detector.detect(doc);

        assert.strictEqual(results.length, 2);
        
        // Primera mutación dentro del array
        assert.strictEqual(results[0].table, 'log');
        assert.strictEqual(results[0].hasWhere, true);
        assert.ok(results[0].queryParams?.some(p => p.column === 'level' && p.value === 'INFO'));
        
        // Segunda mutación dentro del array
        assert.strictEqual(results[1].table, 'session');
        assert.strictEqual(results[1].hasWhere, false);
    });

    it('should NOT detect non-prisma calls (false positives)', () => {
        const code = `
            const myDb = { user: { deleteMany: () => {} } };
            await myDb.user.deleteMany({}); // Should be ignored
        `;
        const doc = new MockDocument(code) as any as vscode.TextDocument;
        const results = detector.detect(doc);

        assert.strictEqual(results.length, 0);
    });

    it('should detect mutations inside .tsx files (React Server Components)', () => {
        const code = `
            import React from 'react';
            import { prisma } from '@/lib/prisma';

            export default async function UsersPage() {
                const handleDelete = async () => {
                    "use server";
                    await prisma.user.deleteMany({ where: { status: 'inactive' } });
                };

                return (
                    <div>
                        <h1>Users</h1>
                        <form action={handleDelete}>
                            <button type="submit">Delete Inactive</button>
                        </form>
                    </div>
                );
            }
        `;
        const doc = new MockDocument(code, 'UsersPage.tsx') as any as vscode.TextDocument;
        const results = detector.detect(doc);

        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].table, 'user');
        assert.strictEqual(results[0].operation, 'deleteMany');
        assert.strictEqual(results[0].hasWhere, true);
        assert.ok(results[0].queryParams?.some(p => p.column === 'status' && p.value === 'inactive'));
    });
});
