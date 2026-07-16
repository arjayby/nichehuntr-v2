import { fileURLToPath } from "node:url";

import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * The web app's tests, run in jsdom against React Testing Library.
 *
 * Deliberately its own config rather than `vite.config.ts` with a `test` block: that config
 * builds the app, and its TanStack Start and Cloudflare plugins stand up a router, a server
 * entry and a Workers shim that a component test neither needs nor can run inside. What is
 * tested here is the search surface's own behaviour — what a user types, reads and clicks —
 * so React and jsdom are the whole of what it takes.
 */
export default defineConfig({
	plugins: [viteReact()],
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
	test: {
		environment: "jsdom",
		setupFiles: ["./src/testing/setup.ts"],
	},
});
