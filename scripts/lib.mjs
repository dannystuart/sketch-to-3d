// Shared helpers: where the skill lives, and bundling a page's code (three.js included) into one file.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

export const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(SKILL, 'package.json'));
const esbuild = require('esbuild');

/** bundle an entry file into one ES module string; three is resolved from the skill's own copy */
export async function bundle(entry, {minify = false, outfile} = {}) {
  const r = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    minify,
    write: !!outfile,
    outfile,
    nodePaths: [path.join(SKILL, 'node_modules')],
    logLevel: 'error',
  });
  return outfile ? outfile : r.outputFiles[0].text;
}
