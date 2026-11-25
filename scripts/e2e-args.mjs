/**
 * pnpm 10 appends a literal `--` to the script command when the user types
 * `pnpm test:e2e -- <args>`. Playwright treats everything after `--` as test
 * file filters, so the options were ignored. Drop one leading `--`.
 */
export function normalizeArgs(args) {
  return args[0] === '--' ? args.slice(1) : args;
}
