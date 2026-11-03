import { defineConfig } from 'tsdown'

/**
 * Two builds, because the two halves obey different contracts:
 *
 *  - host half → plain ESM for Node (cordis loads it normally);
 *  - browser half → must arrive as `factory(require)` inside
 *    `window.__ModuleLoader__.load`, so it is compiled as CJS and then wrapped by
 *    scripts/wrap-client.mjs. Anything not in the host's shared module table
 *    (Radix, lucide, shiki, clsx…) is bundled into it.
 */
export default defineConfig([
  {
    entry: ['src/index.ts', 'src/search.ts'],
    outDir: 'lib',
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    dts: false,
    clean: true,
    external: [/^@deepseek-ai\//],
  },
  {
    entry: ['src/client.tsx'],
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    clean: false,
    /* Every React subpath stays external: bundling a second copy of react-dom
       puts its internals (ReactSharedInternals.S, renamed in React 19) against
       the host's React 18 runtime, which throws on the first render. */
    external: ['react', 'react-dom', 'react-dom/client', 'react-dom/server', 'react/jsx-runtime', 'react/jsx-dev-runtime', /^@deepseek-ai\//],
    /* One file, always: the browser bundle has no module graph, so a split
       chunk (BlockNote's locale/emoji data love to split) would 404 at runtime.
       Dynamic imports are inlined into the single bundle instead. */
    outputOptions: { entryFileNames: 'client.bundle.js', inlineDynamicImports: true },
  },
])
