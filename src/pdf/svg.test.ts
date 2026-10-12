import { describe, expect, it } from 'vitest'
import { svgLength, svgSize } from './svg'

describe('svgLength', () => {
  it('converts the CSS units to px', () => {
    expect(svgLength('64')).toBe(64)
    expect(svgLength('64px')).toBe(64)
    expect(svgLength('96pt')).toBeCloseTo(128, 6)
    expect(svgLength('1in')).toBe(96)
    expect(svgLength('25.4mm')).toBeCloseTo(96, 6)
    expect(svgLength('2.54CM')).toBeCloseTo(96, 6)
    expect(svgLength(' 12.5 px ')).toBe(12.5)
    expect(svgLength('1e2')).toBe(100)
    expect(svgLength('.5in')).toBe(48)
  })

  it('rejects what has no size of its own', () => {
    for (const value of [null, '', '100%', 'auto', '0', '-5', '10furlongs', 'px']) expect(svgLength(value)).toBeNull()
  })
})

describe('svgSize', () => {
  it('prefers explicit width and height', () => {
    expect(svgSize('210mm', '148mm', '0 0 100 100').width).toBeCloseTo(793.7, 1)
    expect(svgSize('64', '32', null)).toEqual({ width: 64, height: 32 })
  })

  it('takes the viewBox when width and height are missing or relative', () => {
    expect(svgSize(null, null, '0 0 100 50')).toEqual({ width: 100, height: 50 })
    expect(svgSize('100%', '100%', '0,0,40,30')).toEqual({ width: 40, height: 30 })
  })

  it('completes a single dimension from the viewBox proportions', () => {
    expect(svgSize('200', null, '0 0 100 50')).toEqual({ width: 200, height: 100 })
    expect(svgSize(null, '25', '0 0 100 50')).toEqual({ width: 50, height: 25 })
  })

  it('falls back to the size browsers assume when nothing is given', () => {
    expect(svgSize(null, null, null)).toEqual({ width: 300, height: 150 })
    expect(svgSize(null, null, '0 0 0 0')).toEqual({ width: 300, height: 150 })
    expect(svgSize('80', null, 'nonsense')).toEqual({ width: 80, height: 150 })
  })
})
