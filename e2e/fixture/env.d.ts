/**
 * Consumer-build constant for the e2e fixture (issue #647).
 *
 * The fixture is a *consumer* of @ait-co/devtools, so — like a real mini-app —
 * it guards `import('@ait-co/devtools/in-app')` with `if (__DEBUG_BUILD__)`.
 * vite.config.ts injects the value via `define` (true only when
 * AIT_DEBUG_BUILD=1). Declared here, in fixture scope, NOT in src/env.d.ts:
 * devtools' own source must never reference this bare identifier (see the note
 * in src/env.d.ts), so the declaration belongs with the consumer that uses it.
 */
declare const __DEBUG_BUILD__: boolean;
