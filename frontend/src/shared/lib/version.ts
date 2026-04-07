/**
 * Single source of truth for the app version.
 *
 * The string is injected by Vite from `package.json` at build time via the
 * `__APP_VERSION__` define (see `vite.config.ts`). Bumping `package.json`
 * automatically updates the sidebar, About page, bug reports, error logs,
 * and update checker — no other files need to change.
 */
export const APP_VERSION: string = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
