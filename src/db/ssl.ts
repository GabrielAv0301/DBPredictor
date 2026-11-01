import type { WorkerSslOptions } from './protocol';

export type SslMode = 'auto' | 'disable' | 'require' | 'verify-ca' | 'verify-full';

export const SSL_MODES: readonly SslMode[] = [
    'auto',
    'disable',
    'require',
    'verify-ca',
    'verify-full',
];

const URL_SSL_PARAMS = ['sslmode', 'ssl', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat'];
const LOCAL_HOSTS = new Set([
    'localhost',
    '127.0.0.1',
    '::1',
    '[::1]',
    '0.0.0.0',
    'host.docker.internal',
]);

export interface ParsedConnection {
    host: string;
    port: string;
    database: string;
    user: string;
    /** `sslmode` (or `ssl`) present in the URL query string. */
    urlSslMode: string | undefined;
}

export function isPostgresUrl(value: string): boolean {
    return /^postgres(?:ql)?:\/\//i.test(value.trim());
}

/** Parses a `postgres://` URL without ever exposing the password. */
export function parseConnectionString(connectionString: string): ParsedConnection | undefined {
    if (!isPostgresUrl(connectionString)) return undefined;
    try {
        const url = new URL(connectionString.trim());
        const hostParam = url.searchParams.get('host') ?? '';
        return {
            host: decodeURIComponent(url.hostname) || hostParam || 'localhost',
            port: url.port || '5432',
            database: decodeURIComponent(url.pathname.replace(/^\//, '')),
            user: decodeURIComponent(url.username),
            urlSslMode: url.searchParams.get('sslmode') ?? url.searchParams.get('ssl') ?? undefined,
        };
    } catch {
        return undefined;
    }
}

/** `user@host:5432/db` — safe to display and log. */
export function describeConnection(connectionString: string): string {
    const parsed = parseConnectionString(connectionString);
    if (!parsed) return 'invalid connection string';
    const user = parsed.user ? `${parsed.user}@` : '';
    return `${user}${parsed.host}:${parsed.port}/${parsed.database}`;
}

export function isLocalHost(host: string): boolean {
    const h = host.toLowerCase();
    return LOCAL_HOSTS.has(h) || h.startsWith('/') || h.endsWith('.localhost');
}

/** Removes TLS parameters from the URL so the explicit setting is authoritative. */
export function stripSslParams(connectionString: string): string {
    try {
        const url = new URL(connectionString.trim());
        for (const p of URL_SSL_PARAMS) url.searchParams.delete(p);
        return url.toString();
    } catch {
        return connectionString;
    }
}

/**
 * Interprets `sslmode` from the URL with libpq semantics. (Recent `pg` versions
 * treat `sslmode=require` as `verify-full`, which breaks providers that use
 * private CAs; QueryGuard applies the libpq meaning explicitly instead.)
 */
function modeFromUrl(value: string | undefined, local: boolean): SslMode | undefined {
    switch (value?.toLowerCase()) {
        case undefined:
            return undefined;
        case 'disable':
        case 'false':
        case '0':
            return 'disable';
        case 'allow':
        case 'prefer':
            return local ? 'disable' : 'require';
        case 'require':
        case 'no-verify':
        case 'true':
        case '1':
            return 'require';
        case 'verify-ca':
            return 'verify-ca';
        case 'verify-full':
            return 'verify-full';
        default:
            return undefined;
    }
}

export interface ResolvedSsl {
    connectionString: string;
    ssl: WorkerSslOptions;
    /** Effective mode, for logs and the UI. */
    effectiveMode: string;
}

/**
 * Decides TLS options, following libpq semantics:
 * - auto: respect `sslmode` in the URL; otherwise no TLS for local hosts and
 *   `require` (encrypted) for remote ones.
 * - require: encrypted, certificate not verified (libpq behaviour).
 * - verify-ca: certificate chain verified, host name not checked.
 * - verify-full: chain and host name verified.
 */
export function resolveSsl(connectionString: string, mode: SslMode, caPem?: string): ResolvedSsl {
    const parsed = parseConnectionString(connectionString);

    if (mode === 'auto') {
        const local = parsed ? isLocalHost(parsed.host) : false;
        mode = modeFromUrl(parsed?.urlSslMode, local) ?? (local ? 'disable' : 'require');
    }

    const stripped = stripSslParams(connectionString);
    switch (mode) {
        case 'disable':
            return { connectionString: stripped, ssl: false, effectiveMode: 'disable' };
        case 'require':
            return {
                connectionString: stripped,
                ssl: { rejectUnauthorized: false, ca: caPem },
                effectiveMode: 'require',
            };
        case 'verify-ca':
            return {
                connectionString: stripped,
                ssl: { rejectUnauthorized: true, ca: caPem, skipHostnameCheck: true },
                effectiveMode: 'verify-ca',
            };
        case 'verify-full':
        default:
            return {
                connectionString: stripped,
                ssl: { rejectUnauthorized: true, ca: caPem },
                effectiveMode: 'verify-full',
            };
    }
}
