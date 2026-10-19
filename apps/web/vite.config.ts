import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/react-router")
          ) {
            return "vendor-react";
          }
          if (id.includes("node_modules/lucide-react")) {
            return "vendor-icons";
          }
          if (id.includes("node_modules/react-markdown") || id.includes("node_modules/remark-gfm")) {
            return "markdown";
          }
        },

      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.API_PROXY_TARGET ?? "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
