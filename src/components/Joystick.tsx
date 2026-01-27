import { useRef, useState, useCallback, useEffect } from "react";
import "./Joystick.css";

export interface JoystickChange {
  x: number; // -1 to 1
  y: number; // -1 to 1 (positive up)
}

export interface JoystickProps {
  size?: number; // px of outer diameter
  knobSize?: number; // px of knob diameter
  deadZone?: number; // 0-1, values below this are treated as 0
  onChange?: (pos: JoystickChange) => void;
  onEnd?: () => void;
}

export default function Joystick({ size = 220, knobSize = 90, deadZone = 0.1, onChange, onEnd }: JoystickProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [knobPos, setKnobPos] = useState({ x: 0, y: 0 }) // px offset from center
  const isActiveRef = useRef(false)
  const lastOutputRef = useRef({ x: 0, y: 0 })
  const keepaliveIntervalRef = useRef<number | null>(null)

  const radius = size / 2
  const knobRadius = knobSize / 2

  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

  // Apply dead zone to a value
  const applyDeadZone = useCallback((value: number): number => {
    if (Math.abs(value) < deadZone) return 0;
    // Scale the remaining range to 0-1
    const sign = value > 0 ? 1 : -1;
    return sign * (Math.abs(value) - deadZone) / (1 - deadZone);
  }, [deadZone]);

  const updateFromEvent = useCallback((clientX: number, clientY: number) => {
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const dx = clientX - cx
    const dy = clientY - cy

    const dist = Math.hypot(dx, dy)
    const max = radius - knobRadius
    const scale = dist > 0 ? Math.min(1, max / dist) : 0
    const x = dx * scale
    const y = dy * scale

    // y positive up for control semantics
    const rawNormX = clamp(x / max, -1, 1)
    const rawNormY = clamp(-y / max, -1, 1)

    // Apply dead zone
    const normX = applyDeadZone(rawNormX)
    const normY = applyDeadZone(rawNormY)

    setKnobPos({ x, y })
    lastOutputRef.current = { x: normX, y: normY }
    onChange?.({ x: normX, y: normY })
  }, [onChange, radius, knobRadius, applyDeadZone])

  // Cleanup keepalive interval on unmount
  useEffect(() => {
    return () => {
      if (keepaliveIntervalRef.current) {
        clearInterval(keepaliveIntervalRef.current)
        keepaliveIntervalRef.current = null
      }
    }
  }, [])

  const handlePointerDown = (e: React.PointerEvent) => {
    ; (e.target as Element).setPointerCapture?.(e.pointerId)
    isActiveRef.current = true
    updateFromEvent(e.clientX, e.clientY)

    // Start keepalive interval to resend position while held still
    if (keepaliveIntervalRef.current) {
      clearInterval(keepaliveIntervalRef.current)
    }
    keepaliveIntervalRef.current = window.setInterval(() => {
      if (isActiveRef.current && onChange) {
        onChange(lastOutputRef.current)
      }
    }, 100) // 10 Hz keepalive

    const move = (ev: PointerEvent) => {
      // Don't filter by pressure - mice have pressure === 0, but we still want to track them
      updateFromEvent(ev.clientX, ev.clientY)
    }
    const up = () => {
      isActiveRef.current = false
      if (keepaliveIntervalRef.current) {
        clearInterval(keepaliveIntervalRef.current)
        keepaliveIntervalRef.current = null
      }
      setKnobPos({ x: 0, y: 0 })
      lastOutputRef.current = { x: 0, y: 0 }
      onChange?.({ x: 0, y: 0 })
      onEnd?.()
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", up)
    }

    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", up)
  }

  return (
    <div
      className="joystick-container"
      ref={containerRef}
      style={{ width: size, height: size }}
      onPointerDown={handlePointerDown}
      role="application"
      aria-label="Virtual joystick"
    >
      <div className="joystick-ring" />
      <div
        className="joystick-knob"
        style={{
          width: knobSize,
          height: knobSize,
          transform: `translate(calc(-50% + ${knobPos.x}px), calc(-50% + ${knobPos.y}px))`,
        }}
      />
    </div>
  )
} 