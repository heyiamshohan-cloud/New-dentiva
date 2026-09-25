import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  main: {
    // Bundle all PURE-JS deps into out/main (*.js), keeping only the native
    // better-sqlite3 external. electron-builder's dep collector repeatedly
    // dropped transitive packages (e.g. archiver-utils) from the packaged
    // app → first-boot crash "Cannot find module". Inlining removes the class.
    plugins: [externalizeDepsPlugin({ exclude: ['archiver', 'extract-zip', 'zod'] })],
    build: {
      outDir: 'out/main',
      sourcemap: false,
      minify: true,
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@main': resolve(__dirname, 'src/main')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      sourcemap: false,
      minify: true,
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/preload.ts') }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    build: {
      outDir: 'out/renderer',
      sourcemap: false,
      minify: true,
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@renderer': resolve(__dirname, 'src/renderer/src')
      }
    },
    server: {
      host: '0.0.0.0'
    }
  }
});
