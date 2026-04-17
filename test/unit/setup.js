const path = require('path');
const moduleAlias = require('module-alias');

// Register the mock as 'vscode'
// In CJS mode, we point to the compiled mock in out/
const mockPath = path.join(__dirname, 'vscode.mock.js');

moduleAlias.addAlias('vscode', mockPath);
