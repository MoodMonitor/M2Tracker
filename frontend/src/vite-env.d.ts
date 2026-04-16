/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_MSW_ENABLED?: 'true' | 'false';
	readonly VITE_MSW_RECORD_FIXTURES?: 'true' | 'false';
	readonly VITE_TURNSTILE_SITE_KEY?: string;
	readonly VITE_TURNSTILE_INVISIBLE_SITE_KEY?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
