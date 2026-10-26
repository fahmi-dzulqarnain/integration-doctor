import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // esbuild drops decorator metadata, which NestJS needs for dependency injection; SWC keeps it.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.test.ts'],
  },
});
