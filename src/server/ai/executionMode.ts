import type { AiToolDefinition, ToolResult } from './types'

// ---------------------------------------------------------------------------
// Prompt 53 — how an AI analysis is allowed to act.
//
//  - 'interactive': the existing AI administrator console (POST /api/ai/analyze).
//    All four whitelisted tools, escalation on needsHuman — unchanged.
//  - 'draft': "Предложить ответ AI" in a conversation. The model only
//    prepares text an operator will review and send himself, so it may READ
//    (check_availability) but never change anything: no appointment is
//    created, moved or cancelled, no escalation is opened, no Message or
//    delivery is ever created. Enforced twice — mutating tools are not even
//    offered to the provider, and any such call is refused before the tool
//    registry is reached (a provider may still ask for an unoffered tool).
// ---------------------------------------------------------------------------

// Prompt 55 — 'qualify': "Разобрать обращение". The model only structures
// the request for the operator (entities + a factual description); no tool
// at all is offered or executed, nothing is changed, nothing escalated.
// MCR-5 — 'auto_reply': the automatic AI administrator answering a customer
// with no operator in the loop. Capabilities are its OWN, never inherited
// from 'interactive': read-only availability only — no appointment is
// created/moved/cancelled, nothing is escalated by the core (the auto-reply
// worker decides handoff itself, after its own validation).
export type AiExecutionMode = 'interactive' | 'draft' | 'qualify' | 'auto_reply'

/** Tools with no side effects — the only ones a draft may run. */
const READ_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set(['check_availability'])

export function isToolAllowed(mode: AiExecutionMode, toolName: string): boolean {
  if (mode === 'interactive') return true
  if (mode === 'draft' || mode === 'auto_reply') return READ_ONLY_TOOL_NAMES.has(toolName)
  return false // 'qualify': no tools
}

/** The tool definitions offered to the provider in this mode. */
export function toolDefinitionsForMode(definitions: readonly AiToolDefinition[], mode: AiExecutionMode): AiToolDefinition[] {
  return definitions.filter((d) => isToolAllowed(mode, d.name))
}

/** A gate rejection (never executed, never logged as a tool execution) for a mutating tool requested in draft / auto-reply mode. */
export function draftModeToolRefusal(toolName: string, mode: AiExecutionMode = 'draft'): ToolResult {
  if (mode === 'auto_reply') {
    return {
      success: false,
      tool: toolName,
      errorCode: 'NOT_ALLOWED_IN_AUTO_REPLY',
      message: 'Automatic replies cannot change bookings — a staff member confirms them',
      attempted: false,
    }
  }
  return {
    success: false,
    tool: toolName,
    errorCode: 'NOT_ALLOWED_IN_DRAFT',
    message: 'This action is not available while preparing a reply draft — the operator performs it',
    attempted: false,
  }
}
