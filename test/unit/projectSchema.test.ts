import * as assert from 'assert';
import { parseDrizzleTables } from '../../src/core/project/drizzleSchema';
import { parsePrismaSchema, prismaAccessorName } from '../../src/core/project/prismaSchema';
import { ProjectModel } from '../../src/core/project/ProjectModel';

describe('Prisma schema parsing', () => {
    const schema = `
datasource db { provider = "postgresql" url = env("DATABASE_URL") }

model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique @map("email_address") // comment with @map("nope")
  website   String   @default("https://example.com") // url with //
  createdAt DateTime @default(now()) @map(name: "created_at")
  posts     Post[]
  profile   Profile?
  @@map("users")
  @@schema("auth")
}

model Post {
  id       Int  @id
  authorId Int  @map("author_id")
  author   User @relation(fields: [authorId], references: [id])
}

model Profile {
  id     Int  @id
  userId Int  @unique
  user   User @relation(fields: [userId], references: [id])
}

enum Role { USER ADMIN }
`;

    it('maps models, tables, schemas and columns', () => {
        const models = parsePrismaSchema(schema);
        assert.deepStrictEqual(
            models.map((m) => [m.name, m.dbName, m.schema]),
            [
                ['User', 'users', 'auth'],
                ['Post', 'Post', undefined],
                ['Profile', 'Profile', undefined],
            ]
        );
        assert.deepStrictEqual(models[0].fields, {
            id: 'id',
            email: 'email_address',
            website: 'website',
            createdAt: 'created_at',
        });
        assert.deepStrictEqual(models[1].fields, { id: 'id', authorId: 'author_id' });
    });

    it('computes client accessor names', () => {
        assert.strictEqual(prismaAccessorName('UserProfile'), 'userProfile');
    });
});

describe('Drizzle schema parsing', () => {
    it('reads pgTable, explicit column names and pgSchema().table', () => {
        const tables = parseDrizzleTables(`
            import { pgTable, pgSchema, serial, integer, text } from 'drizzle-orm/pg-core';
            export const users = pgTable('app_users', {
                id: serial('id').primaryKey(),
                orgId: integer('org_id').notNull(),
                name: text(),
            });
            const auth = pgSchema('auth');
            export const sessions = auth.table('sessions', { userId: integer('user_id') });
        `);
        assert.deepStrictEqual(tables, [
            { variable: 'users', name: 'app_users', columns: { id: 'id', orgId: 'org_id' } },
            {
                variable: 'sessions',
                name: 'sessions',
                schema: 'auth',
                columns: { userId: 'user_id' },
            },
        ]);
    });

    it('applies pgTableCreator prefixes (create-t3-app style)', () => {
        const tables = parseDrizzleTables(`
            export const createTable = pgTableCreator((name) => \`t3_\${name}\`);
            export const posts = createTable('post', (d) => ({ id: d.integer('id') }));
        `);
        assert.strictEqual(tables[0].name, 't3_post');
    });

    it('skips files without table definitions quickly', () => {
        assert.deepStrictEqual(parseDrizzleTables('export const x = 1;'), []);
    });
});

describe('ProjectModel', () => {
    it('indexes per file and forgets removed files', () => {
        const model = new ProjectModel();
        model.setDrizzleFile('a.ts', [{ variable: 'users', name: 'users', columns: {} }]);
        assert.ok(model.hasDrizzleTable('users'));
        model.removeFile('a.ts');
        assert.ok(!model.hasDrizzleTable('users'));
        model.setPrismaFile('schema.prisma', parsePrismaSchema('model BlogPost {\n id Int @id\n}'));
        assert.strictEqual(model.prismaModel('blogPost')?.dbName, 'BlogPost');
    });
});
