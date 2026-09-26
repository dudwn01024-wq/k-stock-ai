import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // No client-side environment file or switch can authorize private mode.
  envDir: false,
  server: {host:'127.0.0.1',proxy:{'/api':{target:'http://127.0.0.1:5000'}}},
  preview: {host:'127.0.0.1',proxy:{'/api':{target:'http://127.0.0.1:5000'}}},
  plugins: [
    react(),
    tailwindcss()
  ]
});
