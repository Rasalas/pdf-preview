import { describe, expect, it } from 'vitest'
import { SignatureFileError, exportSignatures, importSignatures, type Signature } from './signatures'

const a: Signature = { id: 'a', w: 10, h: 5, paths: [[[0, 0], [10, 5]]], pressures: [[0.4, 0.8]] }
const b: Signature = { id: 'b', w: 4, h: 4, paths: [[[0, 0], [4, 4]], [[1, 1]]] }

describe('signature files', () => {
  it('round-trips signatures with fresh ids', () => {
    const back = importSignatures(exportSignatures([a, b]), [])
    expect(back.map(({ w, h, paths, pressures }) => (pressures ? { w, h, paths, pressures } : { w, h, paths }))).toEqual([
      { w: 10, h: 5, paths: a.paths, pressures: a.pressures },
      { w: 4, h: 4, paths: b.paths },
    ])
    expect(back.map((s) => s.id)).not.toContain('a')
  })

  it('leaves out signatures that are already there', () => {
    expect(importSignatures(exportSignatures([a, b]), [a])).toHaveLength(1)
  })

  it('refuses other files and damaged ones', () => {
    expect(() => importSignatures('{"pages": []}', [])).toThrow(SignatureFileError)
    expect(() => importSignatures('nonsense', [])).toThrow(SignatureFileError)
    const damaged = JSON.stringify({ format: 'vorschau-unterschriften', version: 1, signatures: [{ w: 1, h: 1, paths: [[[0, 'x']]] }] })
    expect(() => importSignatures(damaged, [])).toThrow(SignatureFileError)
  })
  it('keeps the ink colour and picture signatures', () => {
    const blue: Signature = { ...a, color: '#1e3a8a' }
    const picture: Signature = { id: 'p', w: 3, h: 2, paths: [], image: 'data:image/png;base64,AAAA' }
    const back = importSignatures(exportSignatures([blue, picture]), [])
    expect(back[0].color).toBe('#1e3a8a')
    expect(back[1].image).toBe(picture.image)
    const bad = JSON.stringify({ format: 'vorschau-unterschriften', version: 1, signatures: [{ w: 1, h: 1, paths: [], image: 'javascript:alert(1)' }] })
    expect(() => importSignatures(bad, [])).toThrow(SignatureFileError)
  })
})
