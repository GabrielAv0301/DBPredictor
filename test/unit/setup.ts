import * as path from 'path';
import * as moduleAlias from 'module-alias';

// Register the mock as 'vscode'
// When compiled, this will be in out/test/unit/setup.js
// and it will point to out/test/unit/vscode.mock.js
const mockPath = path.join(__dirname, 'vscode.mock.js');

moduleAlias.addAlias('vscode', mockPath);
