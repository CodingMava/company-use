import { env } from '@coworker/config';
import { out_of_credit_sentence } from '@coworker/config/billing_words';
import type { Database } from '@coworker/core';
import { AppError, create_logger, format_error_message, type SourceActor } from '@coworker/shared';
import type { WhatsAppGraphConfig } from '@runtime-platform/channels/whatsapp/graph_api';
import { finalize_whatsapp_channel_turn } from '@runtime-platform/channels/whatsapp/turn_finalize';
import { send_whatsapp_reply } from '@runtime-platform/channels/whatsapp/turn_reply';
import type { WhatsAppTurnMetadata } from '@runtime-platform/channels/whatsapp/webhook_payloads';
import {
  type AgentRunJob,
  start_agent_run_for_job,
} from '@runtime-platform/orchestrator/agent_run_job';
import { is_agent_run_stopped } from '@runtime-platform/orchestrator/agent_run_stopped';

const log = create_logger('whatsapp_channel_turn_run');

export const whatsapp_actor_id = 'system:whatsapp';

export type WhatsAppRunStart = {
  workspace_id: string;
  session_id: string;
  user_message: string;
  user_message_is_user_visible?: boolean;
  resumed_from_job_id?: string;
  source_actor: SourceActor;
  turn: WhatsAppTurnMetadata;
  graph: WhatsAppGraphConfig;
  finalized_by: string;
  job?: AgentRunJob | undefined;
};

export async function start_whatsapp_run(db: Database, start: WhatsAppRunStart) {
  const started: { run_id?: string } = {};
  try {
    return await start_agent_run_for_job(
      db,
      {
        workspace_id: start.workspace_id,
        session_id: start.session_id,
        user_message: start.user_message,
        ...(start.user_message_is_user_visible === undefined
          ? {}
          : { user_message_is_user_visible: start.user_message_is_user_visible }),
        ...(start.resumed_from_job_id ? { resumed_from_job_id: start.resumed_from_job_id } : {}),
        source_type: 'whatsapp',
        user_message_source_metadata: { source_actor: start.source_actor, whatsapp: start.turn },
        actor_id: whatsapp_actor_id,
      },
      start.job,
      {
        on_stream_event: (event) => {
          if (event.type === 'run_created') started.run_id = event.run.run_id;
        },
      },
    );
  } catch (error) {
    if (error instanceof AppError && error.code === 'out_of_credits') return null;
    if (started.run_id && !is_agent_run_stopped(error)) {
      await tell_the_sender_the_run_failed(db, start, started.run_id);
    }
    throw error;
  }
}

export async function reply_that_billing_stopped(
  graph: WhatsAppGraphConfig,
  turn: WhatsAppTurnMetadata,
) {
  if (!turn.sender_is_workspace_member) return;
  try {
    await send_whatsapp_reply(graph, turn, out_of_credit_sentence(env.APP_UPGRADE_URL));
  } catch (error) {
    log.error('billing-refusal whatsapp notice failed to send', {
      phone_number_id: turn.phone_number_id,
      error: format_error_message(error),
    });
  }
}

async function tell_the_sender_the_run_failed(
  db: Database,
  start: WhatsAppRunStart,
  run_id: string,
) {
  try {
    await finalize_whatsapp_channel_turn(db, {
      workspace_id: start.workspace_id,
      session_id: start.session_id,
      run_id,
      run_status: 'failed',
      turn: start.turn,
      graph: start.graph,
      actor_id: whatsapp_actor_id,
      finalized_by: start.finalized_by,
    });
  } catch (error) {
    log.error('whatsapp failure notice could not be sent', {
      workspace_id: start.workspace_id,
      run_id,
      error: format_error_message(error),
    });
  }
}
