import { useEffect, useRef } from 'react'
import type { WaveformData } from '../../shared/types'

interface Props {
  waveform: WaveformData | null
  loading: boolean
}

export function WaveformCanvas({ waveform, loading }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const draw = (): void => {
      const rect = canvas.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) return
      const ratio = Math.min(2, window.devicePixelRatio || 1)
      const width = Math.max(1, Math.min(8_192, Math.round(rect.width * ratio)))
      const height = Math.max(1, Math.round(rect.height * ratio))
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
      const context = canvas.getContext('2d')
      if (!context) return
      context.clearRect(0, 0, width, height)
      const center = height / 2
      context.fillStyle = 'rgba(116, 126, 143, .28)'
      context.fillRect(0, Math.floor(center), width, 1)

      const peaks = waveform?.peaks ?? []
      const rms = waveform?.rms ?? []
      if (!peaks.length) {
        context.strokeStyle = loading ? 'rgba(139,124,255,.32)' : 'rgba(104,113,128,.28)'
        context.lineWidth = Math.max(1, ratio)
        for (let x = 0; x < width; x += Math.max(4, Math.round(5 * ratio))) {
          const amplitude = 0.12 + ((x * 17) % 31) / 100
          context.beginPath(); context.moveTo(x, center * (1 - amplitude)); context.lineTo(x, center * (1 + amplitude)); context.stroke()
        }
        return
      }

      const sampleAt = (values: number[], x: number): number => {
        const start = Math.floor(x / width * values.length)
        const end = Math.max(start + 1, Math.ceil((x + 1) / width * values.length))
        let maximum = 0
        for (let index = start; index < Math.min(values.length, end); index += 1) maximum = Math.max(maximum, values[index] ?? 0)
        return maximum
      }

      context.beginPath()
      for (let x = 0; x < width; x += 1) {
        const value = Math.min(1, sampleAt(rms, x) * 1.7)
        const y = center - value * center * .88
        if (x === 0) context.moveTo(x, y); else context.lineTo(x, y)
      }
      for (let x = width - 1; x >= 0; x -= 1) context.lineTo(x, center + Math.min(1, sampleAt(rms, x) * 1.7) * center * .88)
      context.closePath()
      context.fillStyle = 'rgba(67,210,197,.14)'
      context.fill()

      const gradient = context.createLinearGradient(0, 0, 0, height)
      gradient.addColorStop(0, '#9f94ff')
      gradient.addColorStop(.5, '#50d4c8')
      gradient.addColorStop(1, '#9f94ff')
      context.strokeStyle = gradient
      context.globalAlpha = .82
      context.lineWidth = Math.max(1, ratio * .72)
      const step = Math.max(1, Math.round(ratio))
      for (let x = 0; x < width; x += step) {
        const value = Math.max(.015, sampleAt(peaks, x))
        context.beginPath(); context.moveTo(x, center - value * center * .94); context.lineTo(x, center + value * center * .94); context.stroke()
      }
      context.globalAlpha = 1
    }
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    draw()
    return () => observer.disconnect()
  }, [waveform, loading])

  return <div className="waveform waveform-accurate"><canvas ref={canvasRef} aria-label={loading ? '正在生成真实音频波形' : '真实音频波形'} /></div>
}
