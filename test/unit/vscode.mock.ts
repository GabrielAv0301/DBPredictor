export class Position {
    constructor(public line: number, public character: number) {}
}

export class Range {
    public start: Position;
    public end: Position;
    constructor(startLine: number, startChar: number, endLine: number, endChar: number) {
        this.start = new Position(startLine, startChar);
        this.end = new Position(endLine, endChar);
    }
    isEmpty = false;
    isSingleLine = false;
    contains = () => false;
    isEqual = () => false;
    with = () => this;
    intersection = () => undefined;
    union = () => this;
}

export class Selection extends Range {
    constructor(anchorLine: number, anchorChar: number, activeLine: number, activeChar: number) {
        super(anchorLine, anchorChar, activeLine, activeChar);
    }
}

export const TextEditorRevealType = {
    Default: 0,
    InCenter: 1,
    InCenterIfOutsideViewport: 2,
    AtTop: 3
} as const;

export const Uri = {
    file: (path: string) => ({ fsPath: path, toString: () => path }),
    parse: (url: string) => ({ toString: () => url })
};

export const window = {
    showInformationMessage: () => Promise.resolve(),
    showErrorMessage: () => Promise.resolve(),
    withProgress: (_options: unknown, task: (progress: { report: (value: { message?: string }) => void }) => Promise<unknown>) => task({ report: () => {} }),
    createOutputChannel: () => ({
        appendLine: () => {},
        show: () => {},
        clear: () => {}
    })
};

export const commands = {
    registerCommand: () => ({ dispose: () => {} }),
    executeCommand: () => Promise.resolve()
};

export const workspace = {
    getConfiguration: () => ({
        get: () => undefined
    })
};

export interface TextDocument {
    uri: { toString(): string };
    fileName: string;
    languageId: string;
    version: number;
    isDirty: boolean;
    isUntitled: boolean;
    getText(range?: Range): string;
    positionAt(offset: number): Position;
    offsetAt(position: Position): number;
}
