import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  build: { rolldownOptions: { input: ["index.html", "workspace.html"] } },
  plugins: [react(), tailwindcss()],
});
