/** True inside Alice Desktop (Tauri WebView). Detected at runtime so Web and Desktop share one build. */
export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
