import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../', import.meta.url));

export function loadTypeScript(relativePath, mocks = {}, globals = {}) {
  const filename = path.join(root, relativePath);
  const source = fs.readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  const compiledModule = { exports: {} };
  const localRequire = createRequire(filename);
  vm.runInNewContext(outputText, {
    module: compiledModule,
    exports: compiledModule.exports,
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : localRequire(name),
    console,
    Request,
    Response,
    Headers,
    URL,
    process,
    ...globals,
  }, { filename });
  return compiledModule.exports;
}
