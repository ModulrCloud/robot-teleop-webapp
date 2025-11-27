import { useRef, useState, useEffect, useCallback } from "react";
import "./Joystick.css";

export interface JoystickChange {
  x: number; // -1 to 1
  y: number; // -1 to 1 (positive up)
}

export interface JoystickProps {
  size?: number; // px of outer diameter
  knobSize?: number; // px of knob diameter
  onChange?: (pos: JoystickChange) => void;
  onEnd?: () => void;
}

export default function Joystick({ size = 220, knobSize = 90, onChange, onEnd }: JoystickProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [knobPos, setKnobPos] = useState({ x: 0, y: 0 }) // px offset from center

  const radius = size / 2
  const knobRadius = knobSize / 2

  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

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
    const normX = clamp(x / max, -1, 1)
    const normY = clamp(-y / max, -1, 1)

    setKnobPos({ x, y })
    onChange?.({ x: normX, y: normY })
  }, [onChange, radius, knobRadius])

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (e.pressure === 0) return
      updateFromEvent(e.clientX, e.clientY)
    }
    const handlePointerUp = () => {
      setKnobPos({ x: 0, y: 0 })
      onChange?.({ x: 0, y: 0 })
      onEnd?.()
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
      window.removeEventListener("pointercancel", handlePointerUp)
    }

    return () => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
      window.removeEventListener("pointercancel", handlePointerUp)
    }
  }, [onChange, onEnd, updateFromEvent])

  const handlePointerDown = (e: React.PointerEvent) => {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    updateFromEvent(e.clientX, e.clientY)

    const move = (ev: PointerEvent) => updateFromEvent(ev.clientX, ev.clientY)
    const up = () => {
      setKnobPos({ x: 0, y: 0 })
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