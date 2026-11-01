export class QueryGuardError extends Error {
    constructor(
        message: string,
        public readonly code?: string
    ) {
        super(message);
        this.name = 'QueryGuardError';
    }
}

const FRIENDLY_MESSAGES: Record<string, string> = {
    '28P01': 'Authentication failed: check the user name and password.',
    '28000': 'The server rejected the connection (check pg_hba.conf / allowed IPs).',
    '3D000': 'The database does not exist.',
    '57014': 'The query was cancelled because it exceeded the simulation timeout.',
    '55P03': 'A lock could not be acquired in time (the table is locked by another transaction).',
    '25006': 'The database rejected a write: QueryGuard only runs read-only transactions.',
    '42501': 'Permission denied for one of the tables involved.',
    '53300': 'The server has too many connections.',
    ECONNREFUSED: 'Connection refused: is the database running and reachable?',
    ENOTFOUND: 'Host not found: check the host name in the connection string.',
    ETIMEDOUT: 'The connection timed out.',
    EAI_AGAIN: 'DNS lookup failed: check your network connection.',
    SELF_SIGNED_CERT_IN_CHAIN:
        'The server certificate is signed by an unknown CA. Configure "queryguard.sslRootCertPath" or use sslMode "require".',
    DEPTH_ZERO_SELF_SIGNED_CERT:
        'The server uses a self-signed certificate. Configure "queryguard.sslRootCertPath" or use sslMode "require".',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE:
        'The server certificate could not be verified. Configure "queryguard.sslRootCertPath".',
    ERR_TLS_CERT_ALTNAME_INVALID:
        'The certificate does not match the host name. Use sslMode "verify-ca" or fix the host name.',
};

/** Turns low-level errors (pg, Node, TLS) into an actionable message. */
export function friendlyError(message: string, code?: string): string {
    if (code && FRIENDLY_MESSAGES[code]) return `${FRIENDLY_MESSAGES[code]} (${code})`;
    if (/does not support SSL/i.test(message)) {
        return 'The server does not support SSL. Set "queryguard.sslMode" to "disable" for this server.';
    }
    if (/no pg_hba\.conf entry/i.test(message)) {
        return `${message}. The server may require SSL: set "queryguard.sslMode" to "require".`;
    }
    return message;
}
