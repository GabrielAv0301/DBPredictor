import * as ts from 'typescript';
import type { FilterValue, LiteralValue } from '../detectors/types';

export interface ChainCall {
    name: string;
    args: readonly ts.Expression[];
    node: ts.CallExpression;
}

export interface CallChain {
    /** Calls in source order: `a.from('x').delete().eq()` → [from, delete, eq]. */
    calls: ChainCall[];
    /** Expression the chain starts from (`a` above), or undefined for a bare function call. */
    receiver: ts.Expression | undefined;
}

/** Removes wrappers that don't change the value: parentheses, `!`, `as`, `satisfies`, `await`. */
export function unwrap(expr: ts.Expression): ts.Expression {
    let current = expr;
    for (;;) {
        if (
            ts.isParenthesizedExpression(current) ||
            ts.isNonNullExpression(current) ||
            ts.isAsExpression(current) ||
            ts.isSatisfiesExpression(current) ||
            ts.isAwaitExpression(current) ||
            ts.isTypeAssertionExpression(current)
        ) {
            current = current.expression;
        } else {
            return current;
        }
    }
}

/**
 * Decomposes a fluent call chain (`db.delete(t).where(x)`).
 * Only property-access calls are part of the chain; the receiver is whatever
 * expression precedes the first call.
 */
export function getCallChain(outer: ts.CallExpression): CallChain {
    const calls: ChainCall[] = [];
    let current: ts.Expression = outer;
    let receiver: ts.Expression | undefined;

    for (;;) {
        current = unwrap(current);
        if (!ts.isCallExpression(current)) {
            receiver = current;
            break;
        }
        const callee = unwrap(current.expression);
        if (ts.isPropertyAccessExpression(callee)) {
            calls.push({ name: callee.name.text, args: current.arguments, node: current });
            current = callee.expression;
        } else if (ts.isIdentifier(callee)) {
            calls.push({ name: callee.text, args: current.arguments, node: current });
            receiver = undefined;
            break;
        } else {
            receiver = callee;
            break;
        }
    }

    calls.reverse();
    return { calls, receiver };
}

/**
 * True when `node` is an inner link of a bigger chain, e.g. the `.delete()` call in
 * `x.delete().eq()`. Detectors only inspect the outermost call to avoid duplicates.
 */
export function isInnerChainLink(node: ts.CallExpression): boolean {
    let child: ts.Node = node;
    let parent = node.parent;
    while (
        parent &&
        (ts.isParenthesizedExpression(parent) || ts.isNonNullExpression(parent)) &&
        parent.expression === child
    ) {
        child = parent;
        parent = parent.parent;
    }
    return (
        !!parent &&
        ts.isPropertyAccessExpression(parent) &&
        parent.expression === child &&
        !!parent.parent &&
        ts.isCallExpression(parent.parent) &&
        parent.parent.expression === parent
    );
}

/** Name used to recognise a client object: `prisma`, `this.prisma`, `ctx.db` → `prisma` / `db`. */
export function receiverName(expr: ts.Expression | undefined): string | undefined {
    if (!expr) return undefined;
    const e = unwrap(expr);
    if (ts.isIdentifier(e)) return e.text;
    if (ts.isPropertyAccessExpression(e)) return e.name.text;
    return undefined;
}

export function propertyName(name: ts.PropertyName): string | undefined {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
        return name.text;
    }
    if (ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
    return undefined;
}

const NOT_LITERAL = Symbol('not-literal');
type LiteralResult = LiteralValue | LiteralValue[] | typeof NOT_LITERAL | undefined;

function readLiteral(node: ts.Expression): LiteralResult {
    const e = unwrap(node);
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
    if (ts.isNumericLiteral(e)) return Number(e.text);
    if (ts.isBigIntLiteral(e)) return e.text.replace(/n$/, '');
    if (
        ts.isPrefixUnaryExpression(e) &&
        e.operator === ts.SyntaxKind.MinusToken &&
        ts.isNumericLiteral(e.operand)
    ) {
        return -Number(e.operand.text);
    }
    if (e.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (e.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (e.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isIdentifier(e) && e.text === 'undefined') return undefined;
    if (ts.isArrayLiteralExpression(e)) {
        const values: LiteralValue[] = [];
        for (const element of e.elements) {
            const v = readLiteral(element);
            if (v === NOT_LITERAL || v === undefined || Array.isArray(v)) return NOT_LITERAL;
            values.push(v);
        }
        return values;
    }
    return NOT_LITERAL;
}

/**
 * Converts an expression into a filter value.
 * Returns `undefined` for the `undefined` literal: ORMs such as Prisma ignore
 * conditions whose value is `undefined`, which matters for safety.
 */
export function toFilterValue(node: ts.Expression): FilterValue | undefined {
    const literal = readLiteral(node);
    if (literal === undefined) return undefined;
    if (literal === NOT_LITERAL) {
        return { kind: 'expression', text: compactText(node) };
    }
    return { kind: 'literal', value: literal };
}

export function isUndefinedLiteral(node: ts.Expression): boolean {
    const e = unwrap(node);
    return ts.isIdentifier(e) && e.text === 'undefined';
}

/** Single-line, length-capped source text for messages. */
export function compactText(node: ts.Node, max = 80): string {
    const text = node.getText().replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Plain text of a string / template literal with `${…}` replaced by `$n` placeholders. */
export function templateText(node: ts.Expression): string | undefined {
    const e = unwrap(node);
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
    if (ts.isTemplateExpression(e)) {
        let text = e.head.text;
        e.templateSpans.forEach((span, i) => {
            text += `$${i + 1}${span.literal.text}`;
        });
        return text;
    }
    if (ts.isTaggedTemplateExpression(e)) return templateText(e.template);
    return undefined;
}
