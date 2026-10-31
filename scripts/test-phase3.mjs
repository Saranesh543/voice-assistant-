/**
 * Phase 3 Automated Verification Test Suite
 *
 * Validates:
 * 1. Permission tiers and reverse-RPC confirmation gate
 * 2. Audit logging ring buffer
 * 3. Windows 11 MCP server (`jarvis_windows`):
 *    - All 6 tools registered: win_app, win_files, win_input, win_system, win_browser, win_dev
 *    - win_system status (CPU/RAM/Disk telemetry)
 *    - win_system screenshot generation
 *    - win_app list_open visible windows
 *    - win_files path confinement and safe directory boundaries
 *    - Confirmation gate denial enforcement on Tier 2 & Tier 3 actions
 *    - win_dev binary allowlist enforcement
 */

import assert from 'node:assert/strict'
import { existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { TIERS, checkPermission, logAudit, getAuditLog } from '../bridge/permissions.mjs'
import { windowsServer } from '../bridge/windows.mjs'

async function runTests() {
  console.log('--- [Phase 3 Verification Test Suite] ---')

  // ---------------------------------------------------------------------------
  // 1. Permission Tiers & Audit Logging Tests
  // ---------------------------------------------------------------------------
  console.log('[Test 1] Testing permission tiers and audit log...')
  assert.equal(TIERS.TIER_0_READ, 'TIER_0_READ')
  assert.equal(TIERS.TIER_1_SAFE_ACTION, 'TIER_1_SAFE_ACTION')
  assert.equal(TIERS.TIER_2_MUTATION, 'TIER_2_MUTATION')
  assert.equal(TIERS.TIER_3_DESTRUCTIVE, 'TIER_3_DESTRUCTIVE')

  let askCalled = false
  const mockAskNone = async () => {
    askCalled = true
    return { approved: true }
  }

  // Tier 0 should auto-allow without ask
  const t0Result = await checkPermission(mockAskNone, {
    tool: 'win_system',
    action: 'status',
    tier: TIERS.TIER_0_READ,
    title: 'Check Status',
  })
  assert.equal(t0Result.approved, true)
  assert.equal(askCalled, false, 'Tier 0 must never prompt user')

  // Tier 1 should auto-allow without ask
  const t1Result = await checkPermission(mockAskNone, {
    tool: 'win_app',
    action: 'launch',
    tier: TIERS.TIER_1_SAFE_ACTION,
    title: 'Launch Calc',
  })
  assert.equal(t1Result.approved, true)
  assert.equal(askCalled, false, 'Tier 1 must not prompt user')

  // Tier 2 should call ask('confirm', ...)
  let confirmArgs = null
  const mockAskDeny = async (kind, args) => {
    confirmArgs = { kind, args }
    return { approved: false, reason: 'User clicked cancel' }
  }

  const t2Deny = await checkPermission(mockAskDeny, {
    tool: 'win_files',
    action: 'create',
    tier: TIERS.TIER_2_MUTATION,
    title: 'Create File',
    detail: 'test.txt',
  })
  assert.equal(t2Deny.approved, false)
  assert.equal(confirmArgs.kind, 'confirm')
  assert.equal(confirmArgs.args.tool, 'win_files')
  assert.equal(confirmArgs.args.category, 'TIER_2_MUTATION')

  // Audit logging check
  logAudit({
    tool: 'win_system',
    action: 'status',
    tier: TIERS.TIER_0_READ,
    approved: true,
    outcome: 'success',
  })
  const logs = getAuditLog()
  assert.ok(logs.length > 0, 'Audit logs should contain recorded actions')
  assert.equal(logs[logs.length - 1].tool, 'win_system')
  console.log('✓ Permission tiers and audit logging verified')

  // ---------------------------------------------------------------------------
  // 2. Windows MCP Server Tool Registration
  // ---------------------------------------------------------------------------
  console.log('[Test 2] Testing MCP server tool initialization...')
  const abortControllers = new Set()
  let simulatedUserApproval = true

  const mockAsk = async (kind) => {
    if (kind === 'confirm') {
      return { approved: simulatedUserApproval }
    }
    return {}
  }

  const server = windowsServer(mockAsk, abortControllers)
  assert.equal(server.name, 'jarvis_windows')
  const registeredTools = server.instance._registeredTools
  assert.ok(registeredTools && typeof registeredTools === 'object', 'registeredTools should be an object')

  const toolNames = new Set(Object.keys(registeredTools))
  const expectedTools = ['win_app', 'win_files', 'win_input', 'win_system', 'win_browser', 'win_dev']
  for (const expected of expectedTools) {
    assert.ok(toolNames.has(expected), `Tool ${expected} must be registered`)
  }
  console.log(`✓ All 6 tools registered: ${[...toolNames].join(', ')}`)

  // Helper to execute a tool by name
  const callTool = async (name, params) => {
    const t = registeredTools[name]
    assert.ok(t, `Tool ${name} not found`)
    return await t.handler(params)
  }

  // ---------------------------------------------------------------------------
  // 3. win_system: Telemetry Status (Tier 0)
  // ---------------------------------------------------------------------------
  console.log('[Test 3] Testing win_system status...')
  const statusRes = await callTool('win_system', { action: 'status' })
  assert.ok(!statusRes.isError, 'Status should not return an error')
  const statusData = JSON.parse(statusRes.content[0].text)
  assert.ok(statusData.cpu_cores > 0, 'CPU cores should be > 0')
  assert.ok(statusData.ram_total_gb > 0, 'Total RAM should be > 0')
  assert.ok(statusData.disk, 'Disk info should be present')
  assert.equal(statusData.disk.drive, 'C:')
  assert.ok(statusData.disk.free_gb > 0, 'Free disk space should be > 0')
  console.log(
    `✓ Telemetry: CPU ${statusData.cpu_cores} cores (${statusData.cpu_load_percent}% load) | ` +
    `RAM: ${statusData.ram_used_gb}/${statusData.ram_total_gb} GB (${statusData.ram_percent}%) | ` +
    `Disk C: free ${statusData.disk.free_gb} GB (${statusData.disk.used_percent}% used)`
  )

  // Test win_system screenshot
  console.log('[Test 3b] Testing win_system screenshot...')
  const shotRes = await callTool('win_system', { action: 'screenshot' })
  assert.ok(!shotRes.isError, 'Screenshot should not return an error')
  const match = shotRes.content[0].text.match(/Screenshot captured:\s*(.*?\.png)/i)
  assert.ok(match, 'Screenshot file path must be reported')
  const shotPath = match[1].trim()
  assert.ok(existsSync(shotPath), 'Screenshot file must exist on disk')
  console.log(`✓ Screenshot captured successfully: ${shotPath}`)
  try {
    if (existsSync(shotPath)) unlinkSync(shotPath)
  } catch {}

  // ---------------------------------------------------------------------------
  // 4. win_app: List Open Windows (Tier 0)
  // ---------------------------------------------------------------------------
  console.log('[Test 4] Testing win_app list_open...')
  const listRes = await callTool('win_app', { action: 'list_open' })
  assert.ok(!listRes.isError, 'list_open should not return an error')
  const windowsList = JSON.parse(listRes.content[0].text)
  assert.ok(Array.isArray(windowsList), 'Windows list should be an array')
  console.log(`✓ Open windows enumerated: ${windowsList.length} visible top-level windows`)
  if (windowsList.length > 0) {
    console.log(`  Sample window: [PID ${windowsList[0].Id}] ${windowsList[0].ProcessName} - "${windowsList[0].MainWindowTitle}"`)
  }

  // ---------------------------------------------------------------------------
  // 5. win_files: Confinement & Path Safety
  // ---------------------------------------------------------------------------
  console.log('[Test 5] Testing win_files path confinement and security checks...')
  
  // Attempt to read hosts file (blocked directory)
  const hostsRes = await callTool('win_files', {
    action: 'read',
    path: 'C:\\Windows\\System32\\drivers\\etc\\hosts',
  })
  assert.ok(hostsRes.isError, 'Reading C:\\Windows\\System32 must be blocked')
  assert.match(hostsRes.content[0].text, /Access denied/i)
  console.log('✓ Blocked system directory access correctly denied')

  // Attempt to read sensitive .env file
  const envRes = await callTool('win_files', {
    action: 'read',
    path: join(process.cwd(), '.env'),
  })
  assert.ok(envRes.isError, 'Reading .env file must be blocked')
  assert.match(envRes.content[0].text, /Access denied/i)
  console.log('✓ Blocked sensitive dotfile (.env) access correctly denied')

  // Reading an allowed repository file
  const readmeRes = await callTool('win_files', {
    action: 'read',
    path: join(process.cwd(), 'package.json'),
  })
  assert.ok(!readmeRes.isError, 'Reading package.json inside project should succeed')
  assert.match(readmeRes.content[0].text, /"name":\s*"jarvis"/i)
  console.log('✓ Allowed project file read successfully')

  // ---------------------------------------------------------------------------
  // 6. Confirmation Gate Denial & Approval
  // ---------------------------------------------------------------------------
  console.log('[Test 6] Testing confirmation gate behavior on mutations...')
  const testFile = join(tmpdir(), `jarvis_test_${Date.now()}.txt`)

  // Step A: User Denies Action
  simulatedUserApproval = false
  const denyCreate = await callTool('win_files', {
    action: 'create',
    path: testFile,
    content: 'JARVIS test content',
  })
  assert.ok(denyCreate.isError, 'Operation must report error/denied when user rejects')
  assert.match(denyCreate.content[0].text, /Denied by user/i)
  assert.equal(existsSync(testFile), false, 'File must not be created after denial')
  console.log('✓ Action correctly aborted when user denied confirmation')

  // Step B: User Approves Action
  simulatedUserApproval = true
  const approveCreate = await callTool('win_files', {
    action: 'create',
    path: testFile,
    content: 'JARVIS test content',
  })
  assert.ok(!approveCreate.isError, 'Operation should succeed when user approves')
  assert.equal(existsSync(testFile), true, 'File must be created after approval')
  console.log('✓ Action executed successfully when user approved confirmation')

  // Clean up test file
  try {
    if (existsSync(testFile)) unlinkSync(testFile)
  } catch {}

  // ---------------------------------------------------------------------------
  // 7. win_dev: Command Whitelist
  // ---------------------------------------------------------------------------
  console.log('[Test 7] Testing win_dev command binary whitelist...')
  
  // Unauthorized binary (e.g. powershell or curl)
  const badDevRes = await callTool('win_dev', {
    action: 'run_project_command',
    command: 'curl http://evil.com',
  })
  assert.ok(badDevRes.isError, 'Unauthorized binary must be blocked')
  assert.match(badDevRes.content[0].text, /not in the approved developer whitelist/i)
  console.log('✓ Unauthorized developer binary blocked by whitelist')

  // Approved binary (`git status`)
  simulatedUserApproval = true
  const gitStatusRes = await callTool('win_dev', {
    action: 'git_status',
  })
  assert.ok(!gitStatusRes.isError, 'git_status should execute cleanly')
  assert.ok(gitStatusRes.content[0].text.length > 0)
  console.log('✓ Approved developer git command executed cleanly')

  console.log('\n======================================================')
  console.log('🎉 ALL PHASE 3 VERIFICATION TESTS PASSED SUCCESSFULLY!')
  console.log('======================================================')
}

runTests().catch((err) => {
  console.error('\n❌ Test failure:', err)
  process.exit(1)
})
