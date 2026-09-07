import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Injects ad-SDK ids into index.html at build time from environment
// variables, so nothing SDK-related is hardcoded in the HTML source.
// Placeholders used in index.html: %VITE_MONETAG_ZONE_ID%, %VITE_GIGAPUB_SCRIPT_ID%
function envHtmlPlugin(): Plugin {
  const replacements: Array<[RegExp, string | undefined]> = [
    [/\%VITE_MONETAG_ZONE_ID\%/g, process.env.VITE_MONETAG_ZONE_ID || process.env.MONETAG_ZONE_ID || "10013974"],
    [/\%VITE_GIGAPUB_SCRIPT_ID\%/g, process.env.VITE_GIGAPUB_SCRIPT_ID || process.env.GIGAPUB_SCRIPT_ID || "6938"],
  ];
  return {
    name: "env-html-injection",
    transformIndexHtml(html) {
      let out = html;
      for (const [pattern, value] of replacements) {
        out = out.replace(pattern, value ?? "");
      }
      return out;
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    envHtmlPlugin(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          // Only load Replit plugins in development
          await import("@replit/vite-plugin-runtime-error-modal").then((m) => m.default()).catch(() => null),
          await import("@replit/vite-plugin-cartographer").then((m) => m.cartographer()).catch(() => null),
        ].filter(Boolean)
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client", "src"),
      "@shared": path.resolve(__dirname, "shared"),
      "@assets": path.resolve(__dirname, "attached_assets"),
    },
  },
  root: path.resolve(__dirname, "client"),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
    // Chunk splitting keeps the initial JS bundle small so the first paint is faster
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'query-vendor': ['@tanstack/react-query'],
          'ton-vendor': ['@tonconnect/ui-react'],
          'ui-vendor': ['lucide-react', 'framer-motion'],
          'radix-vendor': [
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-tabs',
            '@radix-ui/react-select',
            '@radix-ui/react-toast',
          ],
        },
      },
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5000,
    allowedHosts: true,
    hmr: {
      clientPort: 443,
    },
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
