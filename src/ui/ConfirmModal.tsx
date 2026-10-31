import { useEffect, useState, useId } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from '../store'

export function ConfirmModal() {
  const pending = useStore((s) => s.pendingConfirm)
  const resolveConfirm = useStore((s) => s.resolvePendingConfirm)
  const modalLabelId = useId()
  const modalDescId = useId()

  const [timeLeft, setTimeLeft] = useState(15)

  useEffect(() => {
    if (!pending) return

    const totalMs = pending.request.timeoutMs || 15000
    const start = performance.now()
    setTimeLeft(Math.ceil(totalMs / 1000))

    const interval = setInterval(() => {
      const elapsed = performance.now() - start
      const remainingMs = Math.max(0, totalMs - elapsed)
      const remainingSec = Math.ceil(remainingMs / 1000)
      setTimeLeft(remainingSec)

      if (remainingMs <= 0) {
        clearInterval(interval)
        resolveConfirm(false)
      }
    }, 250)

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'y' || e.key === 'Y' || e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        resolveConfirm(true)
      } else if (e.key === 'n' || e.key === 'N' || e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        resolveConfirm(false)
      }
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })

    return () => {
      clearInterval(interval)
      window.removeEventListener('keydown', onKeyDown, { capture: true })
    }
  }, [pending, resolveConfirm])

  if (!pending) return null

  const { request } = pending
  const isDestructive =
    request.category === 'TIER_3_DESTRUCTIVE' ||
    request.action === 'close' ||
    request.action === 'delete' ||
    request.action === 'shutdown' ||
    request.action === 'reboot'

  const tierColor = isDestructive ? '#ff4d4d' : '#ffb547'
  const tierBg = isDestructive ? 'rgba(255, 77, 77, 0.12)' : 'rgba(255, 181, 71, 0.12)'
  const tierBorder = isDestructive ? 'rgba(255, 77, 77, 0.6)' : 'rgba(255, 181, 71, 0.6)'
  const totalSec = Math.ceil((request.timeoutMs || 15000) / 1000)
  const progressRatio = Math.max(0, Math.min(1, timeLeft / totalSec))

  return (
    <AnimatePresence>
      <div className="confirm-overlay desktop-ctrls" role="presentation">
        <motion.div
          className={`confirm-card desktop-ctrls ${isDestructive ? 'destructive' : 'mutation'}`}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={modalLabelId}
          aria-describedby={modalDescId}
          initial={{ opacity: 0, scale: 0.9, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 15 }}
          transition={{ type: 'spring', stiffness: 350, damping: 28 }}
          style={{
            borderColor: tierBorder,
            boxShadow: `0 0 35px ${isDestructive ? 'rgba(255,77,77,0.35)' : 'rgba(255,181,71,0.35)'}, inset 0 0 20px ${tierBg}`,
          }}
        >
          {/* Holographic HUD corner brackets */}
          <div className="corner corner-tl" style={{ borderColor: tierColor }} />
          <div className="corner corner-tr" style={{ borderColor: tierColor }} />
          <div className="corner corner-bl" style={{ borderColor: tierColor }} />
          <div className="corner corner-br" style={{ borderColor: tierColor }} />

          {/* Header / Kicker */}
          <div className="confirm-header">
            <span
              className="confirm-kicker"
              style={{
                color: tierColor,
                borderColor: tierBorder,
                background: tierBg,
              }}
            >
              {isDestructive ? 'SECURITY PROTOCOL · TIER 3' : 'AUTHORIZATION REQUIRED · TIER 2'}
            </span>
            <span className="confirm-tool mono">
              {request.tool} {request.action ? `· ${request.action}` : ''}
            </span>
          </div>

          {/* Action Title */}
          <h2 id={modalLabelId} className="confirm-title" style={{ color: isDestructive ? '#ffe6e6' : '#fff5e6' }}>
            {request.title}
          </h2>

          {/* Detail snippet */}
          {request.detail && (
            <div id={modalDescId} className="confirm-detail-box">
              <pre className="confirm-detail-text mono">{request.detail}</pre>
            </div>
          )}

          {/* Countdown timer */}
          <div className="confirm-timer-bar-wrap">
            <div
              className="confirm-timer-bar"
              style={{
                width: `${progressRatio * 100}%`,
                backgroundColor: tierColor,
                boxShadow: `0 0 10px ${tierColor}`,
              }}
            />
          </div>
          <div className="confirm-timer-label mono">
            AUTO-DENY IN {timeLeft}s (NO ACTION TAKEN)
          </div>

          {/* Interactive Action Buttons */}
          <div className="confirm-actions">
            <button
              type="button"
              className="confirm-btn confirm-btn-deny desktop-ctrls"
              onClick={() => resolveConfirm(false)}
              title="Deny action (N or Esc)"
            >
              <span className="btn-key">ESC / N</span>
              <span className="btn-text">CANCEL</span>
            </button>

            <button
              type="button"
              className="confirm-btn confirm-btn-approve desktop-ctrls"
              onClick={() => resolveConfirm(true)}
              style={{
                borderColor: tierColor,
                color: tierColor,
              }}
              title="Authorize action (Y or Enter)"
            >
              <span className="btn-key" style={{ background: tierBg, borderColor: tierBorder }}>
                ENTER / Y
              </span>
              <span className="btn-text">AUTHORIZE</span>
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
