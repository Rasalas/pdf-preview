// randomUUID only exists in secure contexts (HTTPS or localhost).
export const newId = (): string =>
  crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
