/** 音频小工具：降采样 + RMS，和 DOM / WebAudio 解耦，方便单测 */

export function downsampleToPcm16(input: Float32Array, inRate: number, outRate: number): Int16Array {
  if (inRate === outRate) {
    const out = new Int16Array(input.length)
    for (let i = 0; i < input.length; i++) {
      const v = Math.max(-1, Math.min(1, input[i]))
      out[i] = v < 0 ? v * 0x8000 : v * 0x7fff
    }
    return out
  }

  const ratio = inRate / outRate
  const length = Math.max(1, Math.floor(input.length / ratio))
  const out = new Int16Array(length)
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * ratio)
    const end = Math.min(input.length, Math.max(start + 1, Math.floor((i + 1) * ratio)))
    let sum = 0
    for (let j = start; j < end; j++) sum += input[j]
    const v = Math.max(-1, Math.min(1, sum / (end - start)))
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff
  }
  return out
}

export function rms(input: Float32Array): number {
  let energy = 0
  for (let i = 0; i < input.length; i++) energy += input[i] * input[i]
  return Math.sqrt(energy / input.length)
}
