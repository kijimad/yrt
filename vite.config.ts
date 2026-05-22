import { defineConfig, build } from 'vite';
import { cpSync } from 'fs';

function chromeExtensionBuild() {
  let isBuild = false;
  return {
    name: 'chrome-extension-build',
    configResolved(config: { command: string }) {
      isBuild = config.command === 'build';
    },
    async closeBundle() {
      if (!isBuild) return;

      // Build page.ts as a second IIFE entry point
      await build({
        configFile: false,
        build: {
          lib: {
            entry: 'src/page.ts',
            formats: ['iife'],
            name: 'page',
            fileName: () => 'page.js',
          },
          outDir: 'dist',
          emptyOutDir: false,
        },
      });

      // Copy static files
      cpSync('manifest.json', 'dist/manifest.json');
      cpSync('icons', 'dist/icons', { recursive: true });
    },
  };
}

export default defineConfig(({ command }) => ({
  test: {
    globals: true,
    environment: 'happy-dom',
    snapshotSerializers: [],
    resolveSnapshotPath: (testPath: string, snapExtension: string) =>
      testPath.replace(/\.test\.ts$/, snapExtension),
  },
  define: command === 'build' ? {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env': JSON.stringify({}),
    'process.emit': 'undefined',
  } : undefined,
  build: {
    lib: {
      entry: 'src/content.tsx',
      formats: ['iife'],
      name: 'content',
      fileName: () => 'content.js',
    },
    outDir: 'dist',
    emptyOutDir: true,
  },
  plugins: [chromeExtensionBuild()],
}));
