import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true,
    port: 5173,
    // De webapp gebruikt relatieve adressen; in productie handelt nginx die af
    // (zie nginx.conf). De dev-server stuurt ze door naar de draaiende stack.
    proxy: {
      "/webhook": "http://localhost:5678",
      "/output": "http://localhost:8080",
      "/files": "http://localhost:8080",
      "/templates": "http://localhost:8080",
    },
  },
});
