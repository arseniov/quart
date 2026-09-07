import { Cli } from 'kysely-codegen';

const url = process.env.DATABASE_URL ?? 'postgres://quart:quart@127.0.0.1:6432/quart';
const outFile = new URL('../src/types.ts', import.meta.url).pathname;

const cli = new Cli();
await cli.run({
  config: {
    dialect: 'postgres',
    url,
    outFile,
    camelCase: true,
  },
});
console.log('✓ kysely types generated');