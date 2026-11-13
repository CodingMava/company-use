import { env } from '@coworker/config';
import type { Database } from '@coworker/core';
import {
  claim_run_turn_finalize,
  list_run_messages,
  list_run_tool_calls,
  record_run_turn_finalize_outcome,
} from '@coworker/core/db/queries/sessions';
import { create_logger, format_error_message } from '@coworker/shared';
import { recover_final_assistant_text } from '@runtime-platform/channels/email/turn_finalize';
import type { WhatsAppGraphConfig } from '@runtime-platform/channels/whatsapp/graph_api';
import { send_whatsapp_reply } from '@runtime-platform/channels/whatsapp/turn_reply';
import type { WhatsAppTurnMetadata } from '@runtime-platform/channels/whatsapp/webhook_payloads';

const log = create_logger('whatsapp_turn_finalize');

export const whatsapp_waiting_for_approval_text =
  'This needs a go-ahead from the team first. If they decide within 24 hours, I will reply here.';
const unresolved_turn_text =
  "I finished working on this but couldn't put a reply together. Send your message again and I'll pick it back up.";
const failed_turn_text =
  'Something went wrong while I worked on this, so no answer came out. Send it again and I will retry.';

type ClosingOutcome =
  | 'delivered_reply'
  | 'sent_unresolved_notice'
  | 'sent_run_failure_notice'
  | 'sent_waiting_notice';

export type WhatsAppTurnFinalizeResult = {
  outcome: ClosingOutcome | 'cancelled_without_notice' | 'already_finalized' | 'send_failed';
};

export type FinalizeWhatsAppTurnInput = {
  workspace_id: string;
  session_id: string;
  run_id: string;
  run_status: string;
  turn: WhatsAppTurnMetadata;
  graph: WhatsAppGraphConfig;
  actor_id: string;
  finalized_by: string;
};

export async function finalize_whatsapp_channel_turn(
  db: Database,
  input: FinalizeWhatsAppTurnInput,
): Promise<WhatsAppTurnFinalizeResult> {
  const claimed = await claim_run_turn_finalize(db, {
    workspace_id: input.workspace_id,
    run_id: input.run_id,
    actor_id: input.actor_id,
    claimed_by: input.finalized_by,
  });
  if (!claimed) return { outcome: 'already_finalized' };

  const result = await deliver_turn_closing_message(db, input);
  await record_run_turn_finalize_outcome(db, {
    workspace_id: input.workspace_id,
    run_id: input.run_id,
    actor_id: input.actor_id,
    outcome: result.outcome,
  });
  return result;
}

async function deliver_turn_closing_message(
  db: Database,
  input: FinalizeWhatsAppTurnInput,
): Promise<WhatsAppTurnFinalizeResult> {
  if (input.run_status === 'cancelled') return { outcome: 'cancelled_without_notice' };
  if (input.run_status === 'waiting' && (await run_holds_a_step_for_approval(db, input))) {
    return send_closing_message(input, waiting_for_approval_notice(input), 'sent_waiting_notice');
  }
  if (input.run_status !== 'completed' && input.run_status !== 'waiting') {
    return send_closing_message(input, failed_turn_text, 'sent_run_failure_notice');
  }
  const run_messages = await list_run_messages(db, input.workspace_id, input.run_id);
  const reply = recover_final_assistant_text(run_messages);
  if (reply) return send_closing_message(input, reply, 'delivered_reply');
  return send_closing_message(input, unresolved_turn_text, 'sent_unresolved_notice');
}

async function run_holds_a_step_for_approval(db: Database, input: FinalizeWhatsAppTurnInput) {
  const tool_calls = await list_run_tool_calls(db, input.workspace_id, input.run_id);
  return tool_calls.some((tool_call) => tool_call.tool_status === 'awaiting_approval');
}

function waiting_for_approval_notice(input: FinalizeWhatsAppTurnInput) {
  if (!input.turn.sender_is_workspace_member) return whatsapp_waiting_for_approval_text;
  const chat_url = new URL(`/chats/${input.session_id}`, env.NEXT_PUBLIC_APP_URL).toString();
  return `${whatsapp_waiting_for_approval_text} It is waiting here: ${chat_url}`;
}

async function send_closing_message(
  input: FinalizeWhatsAppTurnInput,
  text: string,
  outcome: ClosingOutcome,
): Promise<WhatsAppTurnFinalizeResult> {
  try {
    await send_whatsapp_reply(input.graph, input.turn, text);
    return { outcome };
  } catch (error) {
    log.error('whatsapp turn closing message failed to send', {
      workspace_id: input.workspace_id,
      run_id: input.run_id,
      intended_outcome: outcome,
      error: format_error_message(error),
    });
    return { outcome: 'send_failed' };
  }
}
