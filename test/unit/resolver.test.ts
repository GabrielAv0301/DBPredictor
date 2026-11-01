import * as assert from 'assert';
import { parsePrismaSchema } from '../../src/core/project/prismaSchema';
import { ProjectModel } from '../../src/core/project/ProjectModel';
import { resolveColumn, resolveTable, toSnakeCase } from '../../src/core/schema/resolver';
import { schemaIndex, table } from '../helpers';

describe('Table and column resolution', () => {
    const index = schemaIndex(
        [
            table('User', 10, ['id', 'email', 'createdAt']),
            table('users', 99, ['id'], 'auth'),
            table('blog_posts', 5, ['id', 'author_id']),
        ],
        [],
        ['public']
    );
    const empty = new ProjectModel();

    it('converts camelCase to snake_case', () => {
        assert.strictEqual(toSnakeCase('blogPosts'), 'blog_posts');
        assert.strictEqual(toSnakeCase('userID'), 'user_id');
        assert.strictEqual(toSnakeCase('HTTPRequestLog'), 'http_request_log');
    });

    it('maps the Prisma accessor to the PascalCase table Prisma creates', () => {
        const r = resolveTable({ kind: 'prisma-model', name: 'user' }, index, empty);
        assert.strictEqual(r.table?.name, 'User');
        assert.strictEqual(r.table?.schema, 'public');
    });

    it('uses @@map / @@schema when the schema file is indexed', () => {
        const project = new ProjectModel();
        project.setPrismaFile(
            's.prisma',
            parsePrismaSchema('model User {\n id Int @id\n @@map("users")\n @@schema("auth")\n}')
        );
        const r = resolveTable({ kind: 'prisma-model', name: 'user' }, index, project);
        assert.strictEqual(r.table?.schema, 'auth');
    });

    it('falls back to snake_case for Drizzle variables', () => {
        const r = resolveTable({ kind: 'drizzle-variable', name: 'blogPosts' }, index, empty);
        assert.strictEqual(r.table?.name, 'blog_posts');
    });

    it('prefers the search_path for unqualified SQL names and honours explicit schemas', () => {
        assert.strictEqual(
            resolveTable({ kind: 'sql-name', name: 'users' }, index, empty).table?.schema,
            'auth'
        );
        assert.strictEqual(
            resolveTable({ kind: 'sql-name', name: 'users', schema: 'auth' }, index, empty).table
                ?.name,
            'users'
        );
        assert.strictEqual(
            resolveTable({ kind: 'sql-name', name: 'nope' }, index, empty).table,
            undefined
        );
    });

    it('prefers the public schema when a name exists in several schemas', () => {
        const twoSchemas = schemaIndex(
            [table('users', 1, ['id'], 'auth'), table('users', 2)],
            [],
            []
        );
        assert.strictEqual(
            resolveTable({ kind: 'sql-name', name: 'users' }, twoSchemas, empty).table?.schema,
            'public'
        );
    });

    it('resolves columns by mapping, exact name, snake_case and case', () => {
        const posts = index.find('blog_posts')!;
        const ref = { kind: 'drizzle-variable' as const, name: 'blogPosts' };
        assert.strictEqual(resolveColumn('authorId', posts, ref, empty), 'author_id');
        const user = index.find('User')!;
        assert.strictEqual(
            resolveColumn('CREATEDAT', user, { kind: 'prisma-model', name: 'user' }, empty),
            'createdAt'
        );
        assert.strictEqual(
            resolveColumn('missing', user, { kind: 'prisma-model', name: 'user' }, empty),
            undefined
        );
    });
});
