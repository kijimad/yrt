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
      cpSync('styles.css', 'dist/styles.css');
      cpSync('icons', 'dist/icons', { recursive: true });
    },
  };
}

export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
  },
  build: {
    lib: {
      entry: 'src/content.ts',
      formats: ['iife'],
      name: 'content',
      fileName: () => 'content.js',
    },
    outDir: 'dist',
    emptyOutDir: true,
  },
  plugins: [chromeExtensionBuild()],
});
