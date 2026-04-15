import * as vscode from 'vscode';

export type MutationOperation = 'deleteMany' | 'updateMany' | 'delete' | 'update';

export interface MutationInfo {
    table: string;
    operation: MutationOperation;
    hasWhere: boolean;
    whereClause?: string; 
    queryParams?: { column: string, value: unknown }[]; // Parámetros para consultas seguras
    range: vscode.Range;
    sourceText: string;
}

export interface MutationDetector {
    detect(document: vscode.TextDocument): MutationInfo[];
}
