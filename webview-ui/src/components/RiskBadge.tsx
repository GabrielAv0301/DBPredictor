import type { RiskLevel } from '../../../src/shared/types';

const LABEL: Record<RiskLevel, string> = {
    DESTRUCTIVE: 'Destructive',
    CRITICAL: 'Critical',
    WARNING: 'Warning',
    SAFE: 'Safe',
    UNKNOWN: 'Unknown',
};

export function RiskBadge({ level }: { level: RiskLevel }) {
    return (
        <span className={`badge risk-${level.toLowerCase()}`} title={`Risk level: ${LABEL[level]}`}>
            {LABEL[level]}
        </span>
    );
}
