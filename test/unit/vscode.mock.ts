export class Position {
    constructor(
        public line: number,
        public character: number
    ) {}
}

export class MockDocument {
    public text: string;
    public fileName: string;
    constructor(text: string, fileName: string = 'test.ts') {
        this.text = text;
        this.fileName = fileName;
    }
    getText() {
        return this.text;
    }
    positionAt(offset: number): Position {
        const lines = this.text.substring(0, offset).split('\n');
        const line = lines.length - 1;
        const character = lines[line].length;
        return new Position(line, character);
    }
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
    AtTop: 3,
} as const;

export interface Uri {
    fsPath: string;
    toString(): string;
}

export const Uri = {
    file: (path: string) => ({ fsPath: path, toString: () => path }),
    parse: (url: string) => ({ toString: () => url }),
    joinPath: (base: Uri, ...pathSegments: string[]) => ({
        fsPath: base.fsPath + (base.fsPath.endsWith('/') ? '' : '/') + pathSegments.join('/'),
        toString: () => base.toString() + (base.toString().endsWith('/') ? '' : '/') + pathSegments.join('/'),
    }),
};

export const window = {
    showInformationMessage: () => Promise.resolve(),
    showErrorMessage: () => Promise.resolve(),
    showWarningMessage: () => Promise.resolve(),
    withProgress: (
        _options: unknown,
        task: (progress: { report: (value: { message?: string }) => void }) => Promise<unknown>
    ) => task({ report: () => {} }),
    createOutputChannel: () => ({
        appendLine: () => {},
        show: () => {},
        clear: () => {},
    }),
    activeTextEditor: undefined as unknown,
    createWebviewPanel: () => ({
        webview: {
            onDidReceiveMessage: () => ({ dispose: () => {} }),
            postMessage: () => Promise.resolve(),
            asWebviewUri: (uri: Uri) => uri,
            cspSource: 'vscode-resource:',
        },
        onDidDispose: () => ({ dispose: () => {} }),
        reveal: () => {},
        dispose: () => {},
    }),
};

export const commands = {
    registerCommand: () => ({ dispose: () => {} }),
    executeCommand: () => Promise.resolve(),
};

export const workspace = {
    getConfiguration: () => ({
        get: () => undefined,
    }),
    onDidChangeConfiguration: () => ({ dispose: () => {} }),
    onDidChangeTextDocument: () => ({ dispose: () => {} }),
};

export interface Memento {
    get<T>(key: string): T | undefined;
    get<T>(key: string, defaultValue: T): T;
    update(key: string, value: unknown): Thenable<void>;
}

export class MockMemento implements Memento {
    private storage = new Map<string, unknown>();
    get(key: string, defaultValue?: unknown) {
        return this.storage.get(key) ?? defaultValue;
    }
    update(key: string, value: unknown) {
        this.storage.set(key, value);
        return Promise.resolve();
    }
    setKeysForSync() {}
}

export interface SecretStorage {
    get(key: string): Thenable<string | undefined>;
    store(key: string, value: string): Thenable<void>;
    delete(key: string): Thenable<void>;
}

export class MockSecretStorage implements SecretStorage {
    private secrets = new Map<string, string>();
    get(key: string) { return Promise.resolve(this.secrets.get(key)); }
    store(key: string, value: string) { this.secrets.set(key, value); return Promise.resolve(); }
    delete(key: string) { this.secrets.delete(key); return Promise.resolve(); }
}

export interface ExtensionContext {
    globalState: Memento & { setKeysForSync(keys: string[]): void };
    workspaceState: Memento;
    secrets: SecretStorage;
    extensionUri: Uri;
    extensionPath: string;
    subscriptions: { dispose(): void }[];
}

export interface TextDocument {
    uri: Uri;
    fileName: string;
    languageId: string;
    version: number;
    isDirty: boolean;
    isUntitled: boolean;
    getText(range?: Range): string;
    positionAt(offset: number): Position;
    offsetAt(position: Position): number;
}
