export type MutationOperation = 'deleteMany' | 'updateMany' | 'delete' | 'update';

export interface PositionLike {
    line: number;
    character: number;
}

export interface RangeLike {
    start: PositionLike;
    end: PositionLike;
}

export interface DocumentLike {
    getText(): string;
    fileName: string;
    positionAt(offset: number): PositionLike;
}

export interface MutationInfo {
    table: string;
    operation: MutationOperation;
    hasWhere: boolean;
    whereClause?: string; 
    queryParams?: { column: string, value: unknown }[]; // Parámetros para consultas seguras
    range: RangeLike;
    sourceText: string;
}

export interface MutationDetector {
    detect(document: DocumentLike): MutationInfo[];
}
