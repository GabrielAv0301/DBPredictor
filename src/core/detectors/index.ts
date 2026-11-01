import * as ts from 'typescript';
import { isInnerChainLink } from '../analysis/ast';
import { DrizzleDetector, type DrizzleFileContext } from './DrizzleDetector';
import { PrismaDetector } from './PrismaDetector';
import { SupabaseDetector } from './SupabaseDetector';
import type { PartialMutation } from './shared';
import { DEFAULT_DETECTOR_OPTIONS, type DetectorOptions, type MutationInfo } from './types';

export const IGNORE_DIRECTIVE = 'queryguard-ignore';

export type SourceLanguage = 'typescript' | 'typescriptreact' | 'javascript' | 'javascriptreact';

export const SUPPORTED_LANGUAGES: readonly SourceLanguage[] = [
    'typescript',
    'typescriptreact',
    'javascript',
    'javascriptreact',
];

const SCRIPT_KIND: Record<SourceLanguage, ts.ScriptKind> = {
    typescript: ts.ScriptKind.TS,
    typescriptreact: ts.ScriptKind.TSX,
    javascript: ts.ScriptKind.JS,
    javascriptreact: ts.ScriptKind.JSX,
};

function importsDrizzle(sourceFile: ts.SourceFile): boolean {
    return (
        sourceFile.statements.some((statement) => {
            if (
                ts.isImportDeclaration(statement) &&
                ts.isStringLiteral(statement.moduleSpecifier)
            ) {
                return statement.moduleSpecifier.text.startsWith('drizzle-orm');
            }
            return false;
        }) || /require\(\s*['"]drizzle-orm/.test(sourceFile.text)
    );
}

/**
 * Parses a document once and runs every detector over it.
 * Pure function: no VS Code dependency, safe to unit test.
 */
export function analyzeSource(
    text: string,
    fileName: string,
    language: SourceLanguage = 'typescript',
    options: DetectorOptions = DEFAULT_DETECTOR_OPTIONS
): MutationInfo[] {
    const sourceFile = ts.createSourceFile(
        fileName,
        text,
        ts.ScriptTarget.Latest,
        /* setParentNodes */ true,
        SCRIPT_KIND[language]
    );

    const prisma = new PrismaDetector(options);
    const supabase = new SupabaseDetector();
    const drizzle = new DrizzleDetector(options);
    const fileContext: DrizzleFileContext = { importsDrizzle: importsDrizzle(sourceFile) };
    const lines = text.split(/\r?\n/);
    const results: MutationInfo[] = [];

    const record = (node: ts.Node, partial: PartialMutation | null) => {
        if (!partial) return;
        const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
        const ignored =
            (lines[start.line] ?? '').includes(IGNORE_DIRECTIVE) ||
            (start.line > 0 && (lines[start.line - 1] ?? '').includes(IGNORE_DIRECTIVE));
        results.push({
            ...partial,
            range: { start, end },
            sourceText: node.getText(sourceFile),
            ignored,
        });
    };

    const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
            const fromPrisma = prisma.inspectCall(node);
            if (fromPrisma) {
                record(node, fromPrisma);
            } else if (!isInnerChainLink(node)) {
                record(node, supabase.inspectCall(node) ?? drizzle.inspectCall(node, fileContext));
            }
        } else if (ts.isTaggedTemplateExpression(node)) {
            record(node, prisma.inspectTaggedTemplate(node));
        }
        ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return results;
}

export type { MutationInfo } from './types';
