import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // Делает все пути внутри exe относительными
  build: {
    outDir: 'dist'
  }
});
