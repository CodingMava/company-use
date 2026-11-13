import type { Database } from '@coworker/core';
import { type get_session, list_run_messages } from '@coworker/core/db/queries/sessions';
import { find_whatsapp_route } from '@runtime-platform/channels/whatsapp/channel_route';
import {
  start_whatsapp_run,
  whatsapp_actor_id,
} from '@runtime-platform/channels/whatsapp/channel_turn_run';
import { read_whatsapp_graph_config } from '@runtime-platform/channels/whatsapp/graph_api';
import {
  build_whatsapp_source_actor,
  identify_whatsapp_sender,
} from '@runtime-platform/channels/whatsapp/sender_identity';
import { whatsapp_thread_key_prefix } from '@runtime-platform/channels/whatsapp/session_open';
import { finalize_whatsapp_channel_turn } from '@runtime-platform/channels/whatsapp/turn_finalize';
import {
  build_whatsapp_session_target,
  read_whatsapp_turn_metadata,
  type WhatsAppSessionTarget,
  type WhatsAppTurnMetadata,
  whatsapp_session_target_schema,
} from '@runtime-platform/channels/whatsapp/webhook_payloads';
import type { AgentRunJob } from '@runtime-platform/orchestrator/agent_run_job';

type RuntimeSession = NonNullable<Awaited<ReturnType<typeof get_session>>>;

export type WhatsAppTurnContinuation = {
  workspace_id: string;
  session: RuntimeSession;
  asking_run_id: string | undefined;
  job_id: string;
  job: AgentRunJob;
};

const continuation_note = 'Picking the approved step back up.';

export function read_whatsapp_resume_target(session: RuntimeSession): WhatsAppSessionTarget | null {
  if (!session.external_thread_key?.startsWith(whatsapp_thread_key_prefix)) return null;
  const target = whatsapp_session_target_schema.safeParse(session.source_metadata.whatsapp);
  return target.success ? target.data : null;
}

export async function continue_the_whatsapp_turn_that_asked(
  db: Database,
  continuation: WhatsAppTurnContinuation,
): Promise<string | null> {
  const target = read_whatsapp_resume_target(continuation.session);
  if (!target || !continuation.asking_run_id) return null;
  if (!(await run_was_a_whatsapp_turn(db, continuation))) return null;
  const turn = await read_turn_for_the_sender(db, continuation.workspace_id, target);
  if (!turn) return null;

  const graph = read_whatsapp_graph_config();
  const session_id = continuation.session.session_id;
  const run = await start_whatsapp_run(db, {
    workspace_id: continuation.workspace_id,
    session_id,
    user_message: continuation_note,
    user_message_is_user_visible: false,
    resumed_from_job_id: continuation.job_id,
    source_actor: turn.source_actor,
    turn: turn.metadata,
    graph,
    finalized_by: 'whatsapp_policy_continuation',
    job: continuation.job,
  });
  if (!run) throw new Error('The policy resume was rejected: out_of_credits');
  await finalize_whatsapp_channel_turn(db, {
    workspace_id: continuation.workspace_id,
    session_id,
    run_id: run.run_id,
    run_status: run.run_status,
    turn: turn.metadata,
    graph,
    actor_id: whatsapp_actor_id,
    finalized_by: 'whatsapp_policy_continuation',
  });
  return run.run_id;
}

async function run_was_a_whatsapp_turn(db: Database, continuation: WhatsAppTurnContinuation) {
  if (!continuation.asking_run_id) return false;
  const messages = await list_run_messages(
    db,
    continuation.workspace_id,
    continuation.asking_run_id,
  );
  return messages.some((message) => read_whatsapp_turn_metadata(message.source_metadata));
}

async function read_turn_for_the_sender(
  db: Database,
  workspace_id: string,
  target: WhatsAppSessionTarget,
) {
  const lookup = await find_whatsapp_route(db, target.phone_number_id);
  if (!lookup.found || lookup.route.workspace_id !== workspace_id) return null;
  const sender = await identify_whatsapp_sender(db, { route: lookup.route, address: target });
  if (!sender.member && !lookup.route.answer_outside_senders) return null;
  const metadata: WhatsAppTurnMetadata = {
    ...build_whatsapp_session_target(target, target),
    sender_is_workspace_member: Boolean(sender.member),
    message_ids: [],
  };
  return { metadata, source_actor: build_whatsapp_source_actor(sender, target.phone_number_id) };
}
