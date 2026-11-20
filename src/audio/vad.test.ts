import { describe, expect, it } from 'vitest'
import { downsampleToPcm16, rms } from './vad'

describe('downsampleToPcm16', () => {
  it('48k → 16k 长度约为三分之一', () => {
    const input = new Float32Array(4800).fill(0.5)
    const out = downsampleToPcm16(input, 48000, 16000)
    expect(out.length).toBeCloseTo(1600, -1)
    expect(out[0]).toBeGreaterThan(16000)
  })

  it('同采样率直接量化', () => {
    const out = downsampleToPcm16(new Float32Array([0, -1, 1]), 16000, 16000)
    expect(Array.from(out)).toEqual([0, -32768, 32767])
  })
})

describe('rms', () => {
  it('恒定 0.5 的 RMS 是 0.5', () => {
    expect(rms(new Float32Array([0.5, 0.5, 0.5, 0.5]))).toBeCloseTo(0.5)
  })
})
