import type { FilterCondition, FilterValue, LiteralValue } from '../detectors/types';

const SYMBOL: Record<string, string> = {
    eq: '=',
    neq: '<>',
    gt: '>',
    gte: '>=',
    lt: '<',
    lte: '<=',
    in: 'IN',
    like: 'LIKE',
    ilike: 'ILIKE',
};

function literal(value: LiteralValue): string {
    if (value === null) return 'NULL';
    if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
    return String(value);
}

export function describeValue(value: FilterValue | undefined): string {
    if (!value) return '';
    if (value.kind === 'expression') return `‹${value.text}›`;
    if (Array.isArray(value.value)) return `(${value.value.map(literal).join(', ')})`;
    return literal(value.value);
}

/** `id = 42`, `email = ‹input.email›`, `deleted_at IS NULL` */
export function describeFilter(filter: FilterCondition): string {
    if (filter.operator === 'isNull') return `${filter.field} IS NULL`;
    if (filter.operator === 'isNotNull') return `${filter.field} IS NOT NULL`;
    return `${filter.field} ${SYMBOL[filter.operator]} ${describeValue(filter.value)}`;
}
