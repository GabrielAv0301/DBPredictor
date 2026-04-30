/**
 * SSL configuration for database connections.
 * Provides secure, configurable SSL/TLS settings with safe defaults.
 */
export enum SSLMode {
    /** Disable SSL completely (only for local/development) */
    DISABLE = 'disable',
    /** Require SSL, reject unauthorized certificates (default for non-local) */
    REQUIRE = 'require',
    /** Require SSL with certificate verification (recommended for production) */
    VERIFY_CA = 'verify-ca',
    /** Require SSL with full certificate verification (strictest) */
    VERIFY_FULL = 'verify-full',
}

export interface SSLConfig {
    mode: SSLMode;
    /** Path to CA certificate file for verification */
    ca?: string;
    /** Path to client certificate file */
    cert?: string;
    /** Path to client key file */
    key?: string;
}

/**
 * Detect if a connection string points to a local database.
 */
export function isLocalConnection(connectionString: string): boolean {
    return (
        connectionString.includes('localhost') ||
        connectionString.includes('127.0.0.1') ||
        connectionString.includes('0.0.0.0') ||
        connectionString.includes('/var/run/postgresql') ||
        connectionString.startsWith('/')
    );
}

/**
 * Build SSL configuration object for pg Pool from SSLConfig.
 * Returns undefined when SSL should be disabled.
 */
export function buildPGSSLConfig(mode: SSLMode, ca?: string): Record<string, unknown> | undefined {
    switch (mode) {
        case SSLMode.DISABLE:
            return undefined;
        case SSLMode.REQUIRE:
            return { rejectUnauthorized: false };
        case SSLMode.VERIFY_CA:
        case SSLMode.VERIFY_FULL:
            return {
                rejectUnauthorized: true,
                ca: ca,
            };
        default:
            return { rejectUnauthorized: false };
    }
}

/**
 * Get a secure default SSL mode based on connection type.
 */
export function getDefaultSSLMode(connectionString: string): SSLMode {
    if (isLocalConnection(connectionString)) {
        return SSLMode.DISABLE;
    }
    return SSLMode.REQUIRE;
}
