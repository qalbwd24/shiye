import { main } from './revisit/cli.mjs';

// Compatibility entry. No diary files, credentials on disk, GUI or implicit server startup.
process.exitCode = await main(process.argv.slice(2));
