import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/client.ts'],
  outDir: 'lib',
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  dts: false,
  clean: true,
  // React and the host's own packages are resolved by the client module system's
  // shared table, never bundled.
  external: ['react', 'react-dom', 'react/jsx-runtime', /^@deepseek-ai\//],
})
