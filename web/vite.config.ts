/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Files with wall-clock thresholds (step 3: 3 000 entries matched in <= 300 ms). They run alone,
// after the other projects, so that parallel test files do not skew the timing.
const TIMED = ['src/matching/match.test.ts'];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    // Engine and matching tests (*.test.ts) run in Node; component tests (*.test.tsx) in jsdom.
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: TIMED,
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          setupFiles: ['src/test/setupDom.ts'],
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: 'timed',
          environment: 'node',
          include: TIMED,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
