import openapiTS, { astToString } from 'openapi-typescript';
import fs from 'node:fs';

const SOURCE = new URL('../src/openapi.json', import.meta.url);
const OUTPUT = new URL('../src/types.gen.ts', import.meta.url);

const ast = await openapiTS(SOURCE);
fs.writeFileSync(OUTPUT, astToString(ast));
console.log(`wrote ${OUTPUT.pathname}`);