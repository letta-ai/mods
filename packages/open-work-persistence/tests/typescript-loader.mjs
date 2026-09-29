// Offline test loader: use native stripping, or an explicitly supplied existing compiler.
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { pathToFileURL } from 'node:url';

export async function load(url, context, nextLoad) {
  if (!url.endsWith('/mods/open-work-persistence.ts')) return nextLoad(url, context);
  const source = await readFile(new URL(url), 'utf8');
  let output;
  if (process.env.OPEN_WORK_TEST_TYPESCRIPT) {
    const { default: ts } = await import(pathToFileURL(process.env.OPEN_WORK_TEST_TYPESCRIPT).href);
    output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  } else {
    try {
      output = stripTypeScriptTypes(source);
    } catch (error) {
      if (error?.code !== 'ERR_NO_TYPESCRIPT') throw error;
      const { default: ts } = await import('typescript');
      output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    }
  }
  return { format: 'module', source: output, shortCircuit: true };
}
