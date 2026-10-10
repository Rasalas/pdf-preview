/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HOST_NAME?: string
  readonly VITE_PRIVACY_URL?: string
  readonly VITE_IMPRINT_URL?: string
  readonly VITE_FUNDING?: string
}

declare const __APP_VERSION__: string
