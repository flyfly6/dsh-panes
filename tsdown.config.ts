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
    external: ['react', 'react-dom', 'react/jsx-runtime', /^@deepseek-ai\//],
    outputOptions: { entryFileNames: 'client.bundle.js' },
  },
])
