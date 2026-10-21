// @ts-expect-error type error without @types/node package
import process from "node:process";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(() => ({
	plugins: [react(), tailwindcss()],
	clearScreen: false,
	server: {
		port: 1420,
		strictPort: true,
		host: host || false,
		hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
		watch: { ignored: ["**/src-tauri/**"] },
	},
	test: {
		environment: "jsdom",
		globals: true,
		exclude: [...configDefaults.exclude, "scripts/**"],
		setupFiles: ["./src/test-setup.ts"],
	},
}));
