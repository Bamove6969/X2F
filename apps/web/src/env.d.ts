/// <reference types="vite/client" />

/** True only with VITE_FIXTURES=1 in the dev server or a `--mode fixtures` build (vite.config.ts `fixturesOn`). */
declare const __X2F_FIXTURES__: boolean;

/** True only with VITE_X2F_DEMO=1 in the dev server or a `--mode demo` build (vite.config.ts `demoOn`): the /lab/intro route. */
declare const __X2F_DEMO__: boolean;
