/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_PORT?: string;
  readonly VITE_REFERENCE_TIME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
