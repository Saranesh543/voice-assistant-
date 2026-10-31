/**
 * Permission tiers, action audit logging, and reverse-RPC confirmation gate
 * for JARVIS Windows PC Control.
 */

export const TIERS = {
  TIER_0_READ: 'TIER_0_READ',
  TIER_1_SAFE_ACTION: 'TIER_1_SAFE_ACTION',
  TIER_2_MUTATION: 'TIER_2_MUTATION',
  TIER_3_DESTRUCTIVE: 'TIER_3_DESTRUCTIVE',
}

// ---------------------------------------------------------------------------
// In-Memory Audit Log Ring Buffer
// ---------------------------------------------------------------------------
const MAX_AUDIT_ENTRIES = 120
const auditLog = []

/**
 * Sanitize arguments for logging (redact potential keys, tokens, or passwords).
 */
function sanitizeArgs(args) {
  if (!args || typeof args !== 'object') return args
  const sanitized = Array.isArray(args) ? [] : {}
  const SENSITIVE_KEYS = /key|token|password|secret|auth|credential/i

  for (const [k, v] of Object.entries(args)) {
    if (SENSITIVE_KEYS.test(k) && typeof v === 'string') {
      sanitized[k] = v.length > 8 ? `${v.slice(0, 3)}...${v.slice(-3)}` : '[REDACTED]'
    } else if (typeof v === 'object' && v !== null) {
      sanitized[k] = sanitizeArgs(v)
    } else {
      sanitized[k] = v
    }
  }
  return sanitized
}

export function logAudit({ tool, tier, action, target, approved, error = null, durationMs = 0 }) {
  const entry = {
    id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    tool,
    tier,
    action,
    target: sanitizeArgs(target),
    approved,
    error: error ? String(error) : null,
    durationMs,
  }

  auditLog.push(entry)
  if (auditLog.length > MAX_AUDIT_ENTRIES) {
    auditLog.shift()
  }

  const status = approved ? (error ? 'FAILED' : 'APPROVED') : 'DENIED'
  console.log(`[audit] [${tier}] ${tool}:${action} -> ${status}${error ? ` (${error})` : ''}`)
  return entry
}

export function getAuditLog() {
  return [...auditLog]
}

// ---------------------------------------------------------------------------
// Reverse-RPC Confirmation Gate
// ---------------------------------------------------------------------------

/** Session-level pre-authorization cache for Tier 2 mutations (optional) */
const sessionPreAuth = new Set()

export function preAuthorizeAction(key) {
  sessionPreAuth.add(key)
}

export function clearPreAuthorizations() {
  sessionPreAuth.clear()
}

/**
 * Gate an action against permission tiers.
 * - TIER_0_READ: Passes automatically.
 * - TIER_1_SAFE_ACTION: Passes automatically, logged to audit.
 * - TIER_2_MUTATION: Requires user confirmation via HUD gate (or session pre-auth).
 * - TIER_3_DESTRUCTIVE: ALWAYS requires explicit user confirmation via HUD gate.
 *
 * @param {Function} ask - Reverse-RPC function to send message to frontend
 * @param {object} options
 * @param {string} options.tool - Tool name (e.g. 'win_files')
 * @param {string} options.action - Action name (e.g. 'delete')
 * @param {string} options.tier - TIER_0_READ | TIER_1_SAFE_ACTION | TIER_2_MUTATION | TIER_3_DESTRUCTIVE
 * @param {string} options.title - Human-readable title for HUD card
 * @param {string} options.detail - Detail string (target path, app, or arguments)
 * @param {number} [options.timeoutMs=15000] - Confirmation timeout
 * @returns {Promise<{ approved: boolean, reason?: string }>}
 */
export async function checkPermission(ask, {
  tool,
  action,
  tier,
  title,
  detail,
  timeoutMs = 15000,
}) {
  const start = Date.now()

  // Tier 0: Free read access
  if (tier === TIERS.TIER_0_READ) {
    logAudit({ tool, tier, action, target: detail, approved: true, durationMs: 0 })
    return { approved: true }
  }

  // Tier 1: Safe actions (auto-allow + audit log)
  if (tier === TIERS.TIER_1_SAFE_ACTION) {
    logAudit({ tool, tier, action, target: detail, approved: true, durationMs: 0 })
    return { approved: true }
  }

  // Tier 2: Mutation actions (can use pre-auth for session, otherwise prompt)
  const preAuthKey = `${tool}:${action}:${detail}`
  if (tier === TIERS.TIER_2_MUTATION && sessionPreAuth.has(preAuthKey)) {
    logAudit({ tool, tier, action, target: detail, approved: true, durationMs: 0 })
    return { approved: true }
  }

  // Tier 2 or Tier 3: Prompt via Reverse-RPC over WebSocket to HUD
  if (!ask || typeof ask !== 'function') {
    const err = 'Confirmation RPC unavailable (frontend disconnected)'
    logAudit({ tool, tier, action, target: detail, approved: false, error: err, durationMs: Date.now() - start })
    return { approved: false, reason: err }
  }

  try {
    console.log(`[security-gate] Requesting confirmation for [${tier}] ${title}: ${detail}`)
    const reply = await ask(
      'confirm',
      {
        tool,
        action,
        category: tier,
        title,
        detail,
        timeoutMs,
      },
      timeoutMs + 1000,
    )

    const approved = Boolean(reply?.approved)
    const durationMs = Date.now() - start

    logAudit({
      tool,
      tier,
      action,
      target: detail,
      approved,
      error: approved ? null : (reply?.reason || 'User denied action'),
      durationMs,
    })

    return {
      approved,
      reason: approved ? undefined : (reply?.reason || 'Action denied by user.'),
    }
  } catch (err) {
    const durationMs = Date.now() - start
    const reason = err?.message?.includes('in time')
      ? 'Security confirmation timed out (15s elapsed).'
      : `Confirmation gate error: ${err?.message || err}`

    logAudit({
      tool,
      tier,
      action,
      target: detail,
      approved: false,
      error: reason,
      durationMs,
    })

    return { approved: false, reason }
  }
}
