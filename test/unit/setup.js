const path = require('path');
const moduleAlias = require('module-alias');

// Register the mock as 'vscode'
// We point to the compiled version in out/
const mockPath = path.join(__dirname, '..', '..', 'out', 'test', 'unit', 'vscode.mock');
moduleAlias.addAlias('vscode', mockPath);
