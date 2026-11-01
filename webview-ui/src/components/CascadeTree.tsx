import type { CascadeNode } from '../../../src/shared/types';
import { fmt } from '../format';

const RULE_CLASS: Record<CascadeNode['rule'], string> = {
    CASCADE: 'rule-cascade',
    'SET NULL': 'rule-setnull',
    'SET DEFAULT': 'rule-setnull',
    RESTRICT: 'rule-restrict',
    'NO ACTION': 'rule-restrict',
};

const RULE_HINT: Record<CascadeNode['rule'], string> = {
    CASCADE: 'Referencing rows are deleted too.',
    'SET NULL': 'The foreign key column is set to NULL.',
    'SET DEFAULT': 'The foreign key column is set to its default.',
    RESTRICT: 'The statement fails if referencing rows exist.',
    'NO ACTION': 'The statement fails (at commit) if referencing rows exist.',
};

export function CascadeTree({ nodes }: { nodes: CascadeNode[] }) {
    if (nodes.length === 0) return null;
    return (
        <ul className="tree">
            {nodes.map((node, i) => (
                <li key={`${node.table}:${node.columns.join(',')}:${i}`}>
                    <div className="tree-row">
                        <span
                            className={`rule ${RULE_CLASS[node.rule]}`}
                            title={RULE_HINT[node.rule]}
                        >
                            {node.rule}
                        </span>
                        <span className="mono">{node.table}</span>
                        <span className="muted mono">({node.columns.join(', ')})</span>
                        <span className="spacer" />
                        <span className="muted">
                            {node.cyclic
                                ? 'self-reference, not followed'
                                : `~${fmt(node.rowsEstimated)} rows`}
                        </span>
                    </div>
                    <CascadeTree nodes={node.children} />
                </li>
            ))}
        </ul>
    );
}
