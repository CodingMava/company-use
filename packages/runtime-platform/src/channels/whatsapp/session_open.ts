import type { Database } from '@coworker/core';
import {
  find_or_create_session_for_external_thread,
  upsert_session_source_actor,
} from '@coworker/core/db/queries/sessions';
import { find_team_room_of_maker } from '@coworker/core/db/queries/team_room_of_maker';
import type { SourceActor } from '@coworker/shared';
import type { WhatsAppRoute } from '@runtime-platform/channels/whatsapp/channel_route';
import type { WhatsAppSender } from '@runtime-platform/channels/whatsapp/sender_identity';
import {
  build_whatsapp_session_target,
  type WhatsAppSessionTarget,
} from '@runtime-platform/channels/whatsapp/webhook_payloads';

export type WhatsAppSessionOpening = {
  route: WhatsAppRoute;
  sender: WhatsAppSender;
  turn: WhatsAppSessionTarget;
  agent_id: string;
  source_actor: SourceActor;
  actor_id: string;
};

export const whatsapp_thread_key_prefix = 'whatsapp:';

export function whatsapp_thread_key(
  workspace_id: string,
  target: WhatsAppSessionTarget,
  sender: Pick<WhatsAppSender, 'member'>,
) {
  const speaker = sender.member?.user_id ?? 'outside';
  return `${whatsapp_thread_key_prefix}${workspace_id}:${target.phone_number_id}:${target.sender_key}:${speaker}`;
}

export async function open_whatsapp_session(
  db: Database,
  opening: WhatsAppSessionOpening,
): Promise<string> {
  const workspace_id = opening.route.workspace_id;
  const project = opening.route.project_id
    ? { project_id: opening.route.project_id }
    : await find_team_room_of_maker(db, {
        workspace_id,
        maker_id: opening.sender.member?.user_id ?? opening.actor_id,
      });
  const session = await find_or_create_session_for_external_thread(db, {
    workspace_id,
    agent_id: opening.agent_id,
    session_source: 'whatsapp',
    external_thread_key: whatsapp_thread_key(workspace_id, opening.turn, opening.sender),
    session_title: `WhatsApp: ${opening.sender.display_name}`,
    source_metadata: { whatsapp: build_whatsapp_session_target(opening.turn, opening.turn) },
    actor_id: opening.actor_id,
    ...project,
  });
  await upsert_session_source_actor(db, {
    workspace_id,
    session_id: session.session_id,
    source_actor: opening.source_actor,
    observed_time: new Date(),
    actor_id: opening.actor_id,
  });
  return session.session_id;
}
