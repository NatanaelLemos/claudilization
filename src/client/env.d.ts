/** Vite's build-time env, narrowed to what the client actually reads. */
interface ImportMetaEnv {
  /** Public path the app is served under — always ends with "/". */
  readonly BASE_URL: string;
}

interface ImportMeta {
  readonly env?: ImportMetaEnv;
}
