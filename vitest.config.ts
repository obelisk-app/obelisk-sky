import { defineConfig } from 'vitest/config';
import { SHIMS } from './client/vite.config';

export default defineConfig({
  // The same seam as the app build: vendored obelisk-dex as `@/`, with sky's shims.
  resolve: { alias: SHIMS },
  esbuild: { jsx: 'automatic' },
  test: { include: ['server/**/*.test.ts', 'scripts/**/*.test.ts', 'client/src/**/*.test.ts', 'client/src/**/*.test.tsx'] },
});
