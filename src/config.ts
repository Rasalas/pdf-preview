/** Settings that differ per deployment (GitHub Pages, git.nrw, desktop), set at build time. */
export const deployment = {
  /** Who serves the app, named in the privacy note. Empty for local builds. */
  host: import.meta.env.VITE_HOST_NAME ?? '',
  privacyUrl: import.meta.env.VITE_PRIVACY_URL ?? '',
  imprintUrl: import.meta.env.VITE_IMPRINT_URL ?? '',
  /** Show the donation links; only the author's own deployments do. */
  funding: import.meta.env.VITE_FUNDING === '1',
}

export const links = {
  source: 'https://github.com/Rasalas/pdf-preview',
  issues: 'https://github.com/Rasalas/pdf-preview/issues',
  coffee: 'https://buymeacoffee.com/tbuck91j',
  sponsors: 'https://github.com/sponsors/Rasalas',
}

export const version = __APP_VERSION__
