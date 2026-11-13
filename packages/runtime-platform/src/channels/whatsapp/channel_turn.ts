import type { Database } from '@coworker/core';
import { find_workspace_main_agent } from '@coworker/core/db/queries/workspace_agents';
import { create_logger, format_error_message } from '@coworker/shared';
import type { WhatsAppRoute } from '@runtime-platform/channels/whatsapp/channel_route';
import {
  reply_that_billing_stopped,
  start_whatsapp_run,
  whatsapp_actor_id,
} from '@runtime-platform/channels/whatsapp/channel_turn_run';
import {
  show_whatsapp_typing,
  type WhatsAppGraphConfig,
} from '@runtime-platform/channels/whatsapp/graph_api';
import { whatsapp_turn_text } from '@runtime-platform/channels/whatsapp/inbound_text';
import {
  build_whatsapp_source_actor,
  type WhatsAppSender,
} from '@runtime-platform/channels/whatsapp/sender_identity';
import { open_whatsapp_session } from '@runtime-platform/channels/whatsapp/session_open';
import {
  finalize_whatsapp_channel_turn,
  type WhatsAppTurnFinalizeResult,
} from '@runtime-platform/channels/whatsapp/turn_finalize';
import {
  build_whatsapp_session_target,
  type WhatsAppEventMessage,
  type WhatsAppTurnMetadata,
} from '@runtime-platform/channels/whatsapp/webhook_payloads';
import type { AgentRunJob } from '@runtime-platform/orchestrator/agent_run_job';

const log = create_logger('whatsapp_channel_turn');

export type StartWhatsAppChannelTurnInput = {
  route: WhatsAppRoute;
  phone_number_id: string;
  display_phone_number: string;
  sender: WhatsAppSender;
  messages: WhatsAppEventMessage[];
  graph: WhatsAppGraphConfig;
  job?: AgentRunJob;
};

type WhatsAppTurnRefusalCode = 'sender_not_a_member' | 'agent_missing' | 'out_of_credits';

export type StartWhatsAppChannelTurnResult =
  | {
      accepted: true;
      session_id: string;
      run_id: string;
      turn_finalize: WhatsAppTurnFinalizeResult;
    }
  | { accepted: false; code: WhatsAppTurnRefusalCode; message: string };

export async function start_whatsapp_channel_turn(
  db: Database,
  input: StartWhatsAppChannelTurnInput,
): Promise<StartWhatsAppChannelTurnResult> {
  if (!input.sender.member && !input.route.answer_outside_senders) {
    return refused('sender_not_a_member', 'The WhatsApp sender is not linked to a member.');
  }
  const agent = await find_workspace_main_agent(db, input.route.workspace_id);
  if (!agent) return refused('agent_missing', 'The workspace has no active main agent.');

  const turn = build_whatsapp_turn(input);
  const source_actor = build_whatsapp_source_actor(input.sender, input.phone_number_id);
  await show_typing_for_last_message(input);
  const session_id = await open_whatsapp_session(db, {
    route: input.route,
    sender: input.sender,
    turn,
    agent_id: agent.agent_id,
    source_actor,
    actor_id: whatsapp_actor_id,
  });
  const run = await start_whatsapp_run(db, {
    workspace_id: input.route.workspace_id,
    session_id,
    user_message: whatsapp_turn_text(input.messages),
    source_actor,
    turn,
    graph: input.graph,
    finalized_by: 'whatsapp_channel_turn',
    job: input.job,
  });
  if (!run) {
    await reply_that_billing_stopped(input.graph, turn);
    return refused('out_of_credits', 'The workspace cannot run right now.');
  }

  const turn_finalize = await finalize_whatsapp_channel_turn(db, {
    workspace_id: input.route.workspace_id,
    session_id,
    run_id: run.run_id,
    run_status: run.run_status,
    turn,
    graph: input.graph,
    actor_id: whatsapp_actor_id,
    finalized_by: 'whatsapp_channel_turn',
  });
  return { accepted: true, session_id, run_id: run.run_id, turn_finalize };
}

function refused(code: WhatsAppTurnRefusalCode, message: string): StartWhatsAppChannelTurnResult {
  return { accepted: false, code, message };
}

function build_whatsapp_turn(input: StartWhatsAppChannelTurnInput): WhatsAppTurnMetadata {
  return {
    ...build_whatsapp_session_target(input, input.sender),
    sender_is_workspace_member: Boolean(input.sender.member),
    message_ids: input.messages.map((message) => message.message_id),
  };
}

async function show_typing_for_last_message(input: StartWhatsAppChannelTurnInput) {
  const last_message = input.messages.at(-1);
  if (!last_message) return;
  try {
    await show_whatsapp_typing(input.graph, {
      phone_number_id: input.phone_number_id,
      message_id: last_message.message_id,
    });
  } catch (error) {
    log.warn('whatsapp typing indicator failed', { error: format_error_message(error) });
  }
}
