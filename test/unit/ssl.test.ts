import * as assert from 'assert';
import {
    describeConnection,
    isLocalHost,
    parseConnectionString,
    resolveSsl,
} from '../../src/db/ssl';

describe('Connection strings and TLS', () => {
    it('parses URLs without exposing the password', () => {
        const url = 'postgresql://app:s3cr%40t@db.example.com:6543/main?sslmode=require';
        assert.deepStrictEqual(parseConnectionString(url), {
            host: 'db.example.com',
            port: '6543',
            database: 'main',
            user: 'app',
            urlSslMode: 'require',
        });
        assert.strictEqual(describeConnection(url), 'app@db.example.com:6543/main');
        assert.ok(!describeConnection(url).includes('s3cr'));
        assert.strictEqual(parseConnectionString('host=x user=y'), undefined);
    });

    it('detects local hosts by parsed host name, not substring', () => {
        assert.ok(isLocalHost('localhost'));
        assert.ok(isLocalHost('127.0.0.1'));
        assert.ok(!isLocalHost('localhost.evil.com'));
        const remote = resolveSsl('postgres://u:p@localhost.evil.com/db', 'auto');
        assert.strictEqual(remote.effectiveMode, 'require');
    });

    it('auto: no TLS for localhost, require for remote', () => {
        assert.strictEqual(resolveSsl('postgres://u:p@localhost/db', 'auto').ssl, false);
        assert.deepStrictEqual(resolveSsl('postgres://u:p@db.supabase.co/db', 'auto').ssl, {
            rejectUnauthorized: false,
            ca: undefined,
        });
    });

    it('auto: applies libpq semantics of sslmode in the URL and strips it', () => {
        const r = resolveSsl('postgres://u:p@host/db?sslmode=require&application_name=x', 'auto');
        assert.strictEqual(r.effectiveMode, 'require');
        assert.ok(!r.connectionString.includes('sslmode'));
        assert.ok(r.connectionString.includes('application_name=x'));
        assert.strictEqual(
            resolveSsl('postgres://u:p@host/db?sslmode=verify-full', 'auto').effectiveMode,
            'verify-full'
        );
        assert.strictEqual(resolveSsl('postgres://u:p@host/db?sslmode=disable', 'auto').ssl, false);
    });

    it('explicit modes override the URL', () => {
        const r = resolveSsl('postgres://u:p@host/db?sslmode=disable', 'verify-ca', 'PEM');
        assert.deepStrictEqual(r.ssl, {
            rejectUnauthorized: true,
            ca: 'PEM',
            skipHostnameCheck: true,
        });
        assert.ok(!r.connectionString.includes('sslmode'));
    });

    it('keeps percent-encoded passwords intact when rewriting the URL', () => {
        const r = resolveSsl(
            'postgresql://u:p%40ss%2Fw0rd@host:5432/db?sslmode=require',
            'require'
        );
        assert.strictEqual(r.connectionString, 'postgresql://u:p%40ss%2Fw0rd@host:5432/db');
    });
});
