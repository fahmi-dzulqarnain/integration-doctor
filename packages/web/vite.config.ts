import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    // `npm run dev` with the API on its default port; in Docker, nginx does this.
    proxy: { '/api': 'http://localhost:3000' },
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
  },
});
