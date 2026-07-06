import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { aiRegexPlugin } from './server/aiRegexPlugin.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), aiRegexPlugin()],
})
