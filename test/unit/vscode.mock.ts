export const Position = class {
    constructor(public line: number, public character: number) {}
};

export const Range = class {
    public start: any;
    public end: any;
    constructor(startLine: number, startChar: number, endLine: number, endChar: number) {
        this.start = new Position(startLine, startChar);
        this.end = new Position(endLine, endChar);
    }
};

export const Selection = class extends Range {
    constructor(anchorLine: number, anchorChar: number, activeLine: number, activeChar: number) {
        super(anchorLine, anchorChar, activeLine, activeChar);
    }
};

export enum TextEditorRevealType {
    Default = 0,
    InCenter = 1,
    InCenterIfOutsideViewport = 2,
    AtTop = 3
}

export const Uri = {
    file: (path: string) => ({ fsPath: path, toString: () => path }),
    parse: (url: string) => ({ toString: () => url })
};

export const window = {
    showInformationMessage: () => Promise.resolve(),
    showErrorMessage: () => Promise.resolve(),
    withProgress: (options: any, task: any) => task({ report: () => {} }),
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
        get: (key: string) => undefined
    })
};
