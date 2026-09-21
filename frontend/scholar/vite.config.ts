import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Bind 0.0.0.0 so the page is reachable from Windows when Vite
    // runs inside WSL. Without this you get "Unable to connect".
    host: true,
    port: 5173,
    strictPort: true,
  },
});
