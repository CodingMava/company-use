import type { Database, event_jobs, events } from '@coworker/core';
import { get_run, list_run_messages } from '@coworker/core/db/queries/sessions';
import type { EventJobHandlerResult } from '@coworker/jobs';
import { create_logger } from '@coworker/shared';
import {
  find_whatsapp_route,
  type WhatsAppRoute,
} from '@runtime-platform/channels/whatsapp/channel_route';
import { start_whatsapp_channel_turn } from '@runtime-platform/channels/whatsapp/channel_turn';
import { whatsapp_actor_id } from '@runtime-platform/channels/whatsapp/channel_turn_run';
import { read_whatsapp_graph_config } from '@runtime-platform/channels/whatsapp/graph_api';
import {
  identify_whatsapp_sender,
  type WhatsAppSender,
} from '@runtime-platform/channels/whatsapp/sender_identity';
import { finalize_whatsapp_channel_turn } from '@runtime-platform/channels/whatsapp/turn_finalize';
import {
  read_whatsapp_turn_metadata,
  type WhatsAppEventBody,
  type WhatsAppEventMessage,
  whatsapp_event_body_schema,
} from '@runtime-platform/channels/whatsapp/webhook_payloads';
import {
  hold_job_for_credit_top_up,
  job_is_still_waiting_for_credit,
} from '@runtime-platform/events/credit_top_up_hold';
import { read_agent_run_job } from '@runtime-platform/orchestrator/agent_run_job';

const log = create_logger('whatsapp_agent_message_job');

type WhatsAppAgentMessageJobInput = {
  db: Database;
  workspace_id: string;
  queue_key: string;
  event_jobs: (typeof event_jobs.$inferSelect)[];
  events: (typeof events.$inferSelect)[];
  record_started_run_id?: (run_id: string) => Promise<void>;
  signal?: AbortSignal;
};

type WhatsAppConversation = {
  phone_number_id: string;
  display_phone_number: string;
  messages: [WhatsAppEventMessage, ...WhatsAppEventMessage[]];
};

type WhatsAppTurnOutcome = { run_id?: string; session_id?: string; code?: string };

const finished_run_statuses = new Set(['completed', 'cancelled', 'failed', 'waiting']);

export async function run_whatsapp_agent_message_job(
  input: WhatsAppAgentMessageJobInput,
): Promise<EventJobHandlerResult> {
  const recovered = await finish_job_for_finished_run(input);
  if (recovered) return recovered;
  if (await job_is_still_waiting_for_credit(input.db, input)) return hold_for_credit(input);

  const conversation = read_conversation(input.events);
  if (!conversation) return ignored_job_result('no_whatsapp_event');
  const lookup = await find_whatsapp_route(input.db, conversation.phone_number_id);
  if (!lookup.found || lookup.route.workspace_id !== input.workspace_id) {
    return ignored_job_result(lookup.found ? 'route_moved_workspace' : lookup.reason);
  }

  const turn = await run_whatsapp_turn(input, lookup.route, conversation);
  if (turn.code === 'out_of_credits') return hold_for_credit(input);
  return {
    job_status: 'done',
    ...(turn.run_id ? { run_id: turn.run_id } : {}),
    result_data: { turns: [turn] },
  };
}

async function run_whatsapp_turn(
  input: WhatsAppAgentMessageJobInput,
  route: WhatsAppRoute,
  conversation: WhatsAppConversation,
): Promise<WhatsAppTurnOutcome> {
  const [first_message] = conversation.messages;
  const sender = await identify_whatsapp_sender(input.db, {
    route,
    address: {
      sender_key: first_message.sender_key,
      sender_wa_id: conversation.messages.find((message) => message.sender_wa_id)?.sender_wa_id,
      sender_user_id: first_message.sender_user_id,
    },
    profile_name: conversation.messages.find((message) => message.sender_name)?.sender_name,
  });
  const result = await start_whatsapp_channel_turn(input.db, {
    route,
    phone_number_id: conversation.phone_number_id,
    display_phone_number: conversation.display_phone_number,
    sender,
    messages: conversation.messages,
    graph: read_whatsapp_graph_config(),
    job: read_agent_run_job(input),
  });
  if (result.accepted) return { run_id: result.run_id, session_id: result.session_id };
  log_refused_turn(input, sender, result.code);
  return { code: result.code };
}

function log_refused_turn(
  input: WhatsAppAgentMessageJobInput,
  sender: WhatsAppSender,
  code: string,
) {
  log.warn('whatsapp turn was not started', {
    code,
    sender_match: sender.match,
    sender_wa_id: sender.sender_wa_id ?? null,
    workspace_id: input.workspace_id,
    queue_key: input.queue_key,
  });
}

function read_conversation(
  records: WhatsAppAgentMessageJobInput['events'],
): WhatsAppConversation | null {
  const bodies = records
    .filter((record) => record.source === 'whatsapp' && record.event_status !== 'ignored')
    .sort((left, right) => left.created_time.getTime() - right.created_time.getTime())
    .flatMap((record) => {
      const body = whatsapp_event_body_schema.safeParse(record.event_body);
      return body.success ? [body.data] : [];
    });
  const [first_body] = bodies;
  if (!first_body) return null;
  const [first_message, ...later_messages] = unique_messages(bodies);
  if (!first_message) return null;
  return {
    phone_number_id: first_body.phone_number_id,
    display_phone_number: first_body.display_phone_number,
    messages: [first_message, ...later_messages],
  };
}

function unique_messages(bodies: WhatsAppEventBody[]) {
  const seen_message_ids = new Set<string>();
  return bodies.flatMap((body) =>
    body.messages.filter((message) => {
      if (seen_message_ids.has(message.message_id)) return false;
      seen_message_ids.add(message.message_id);
      return true;
    }),
  );
}

async function finish_job_for_finished_run(
  input: WhatsAppAgentMessageJobInput,
): Promise<EventJobHandlerResult | null> {
  const run_id = input.event_jobs.find((job) => job.run_id)?.run_id;
  if (!run_id) return null;
  const run = await get_run(input.db, input.workspace_id, run_id);
  if (!run || !finished_run_statuses.has(run.run_status)) return null;

  const run_messages = await list_run_messages(input.db, input.workspace_id, run_id);
  const opening = run_messages.find((message) =>
    read_whatsapp_turn_metadata(message.source_metadata),
  );
  const turn = read_whatsapp_turn_metadata(opening?.source_metadata);
  if (turn && opening?.session_id) {
    await finalize_whatsapp_channel_turn(input.db, {
      workspace_id: input.workspace_id,
      session_id: opening.session_id,
      run_id,
      run_status: run.run_status,
      turn,
      graph: read_whatsapp_graph_config(),
      actor_id: whatsapp_actor_id,
      finalized_by: 'whatsapp_agent_message_job_recovery',
    });
  }
  return { job_status: 'done', run_id, result_data: { recovered_started_run: true } };
}

function hold_for_credit(input: WhatsAppAgentMessageJobInput) {
  return hold_job_for_credit_top_up({
    event_jobs: input.event_jobs,
    code: 'out_of_credits',
    message: 'Workspace is out of credits.',
  });
}

function ignored_job_result(reason: string): EventJobHandlerResult {
  return { job_status: 'done', result_data: { dispatched: false, code: reason } };
}
