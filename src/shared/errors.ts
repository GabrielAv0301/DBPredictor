/**
 * Custom error classes for the QueryGuard extension.
 * Provides type-safe error handling and better UX messages.
 */

export enum ErrorCode {
    CONNECTION_FAILED = 'CONNECTION_FAILED',
    AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
    SIMULATION_TIMEOUT = 'SIMULATION_TIMEOUT',
    SIMULATION_FAILED = 'SIMULATION_FAILED',
    SCHEMA_FETCH_FAILED = 'SCHEMA_FETCH_FAILED',
    WORKER_ERROR = 'WORKER_ERROR',
    INVALID_IDENTIFIER = 'INVALID_IDENTIFIER',
    SIMULATION_CASCADE_LIMITATION = 'SIMULATION_CASCADE_LIMITATION',
}

export class QueryGuardError extends Error {
    constructor(
        public readonly code: ErrorCode,
        message: string,
        public readonly details?: unknown
    ) {
        super(message);
        this.name = 'QueryGuardError';
    }

    /**
     * Converts the error to a user-friendly message.
     */
    public toUserMessage(): string {
        switch (this.code) {
            case ErrorCode.CONNECTION_FAILED:
                return `Database connection failed: ${this.message}`;
            case ErrorCode.AUTHENTICATION_FAILED:
                return `Authentication failed: ${this.message}. Check your credentials.`;
            case ErrorCode.SIMULATION_TIMEOUT:
                return 'Simulation timed out. The query might be too complex for a safe dry-run.';
            case ErrorCode.INVALID_IDENTIFIER:
                return `Security Alert: ${this.message}`;
            case ErrorCode.SIMULATION_CASCADE_LIMITATION:
                return 'Simulation note: UPDATE operations cannot trigger DELETE cascades. Cascade analysis is informational only for UPDATE. Use the exact simulation for DELETE operations.';
            default:
                return `An error occurred (${this.code}): ${this.message}`;
        }
    }
}
