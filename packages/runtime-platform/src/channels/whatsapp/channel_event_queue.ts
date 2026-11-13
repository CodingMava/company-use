import type { Database } from '@coworker/core';
import type { EnqueueEventInput } from '@coworker/core/db/queries/events';
import { event_job_queue_barrier_metadata_key, queue_and_run_event_jobs } from '@coworker/jobs';
import { create_logger } from '@coworker/shared';
import type { VerifiedChannelEvent } from '@runtime-platform/channels/channel_ingress';
import { find_whatsapp_route } from '@runtime-platform/channels/whatsapp/channel_route';
import { build_whatsapp_event_message } from '@runtime-platform/channels/whatsapp/inbound_text';
import { list_whatsapp_deliveries } from '@runtime-platform/channels/whatsapp/webhook_contents';
import {
  type WhatsAppDelivery,
  type WhatsAppEventBody,
  whatsapp_webhook_body_schema,
} from '@runtime-platform/channels/whatsapp/webhook_payloads';
import { find_event_job_handler } from '@runtime-platform/events/event_job_handler_registry';

const log = create_logger('whatsapp_channel_event_queue');

export const whatsapp_agent_message_handler = 'whatsapp_agent_message';

type ConversationDeliveries = [WhatsAppDelivery, ...WhatsAppDelivery[]];

export async function prepare_whatsapp_channel_event_jobs(
  db: Database,
  event: VerifiedChannelEvent,
): Promise<EnqueueEventInput | null> {
  const body = whatsapp_webhook_body_schema.safeParse(event.raw_event);
  const conversations = group_by_conversation(
    body.success ? list_whatsapp_deliveries(body.data) : [],
  );
  if (conversations.length === 0) {
    log.error('whatsapp event was not queued', drop_details(event, 'webhook_payload_invalid'));
    return null;
  }

  const prepared = await Promise.all(
    conversations.map((deliveries) => prepare_conversation_event(db, event, deliveries)),
  );
  const [first_event, ...other_events] = prepared.flatMap((input) => (input ? [input] : []));
  await Promise.all(
    other_events.map((input) => queue_and_run_event_jobs(db, input, find_event_job_handler)),
  );
  return first_event ?? null;
}

export function whatsapp_queue_key(
  workspace_id: string,
  conversation: Pick<WhatsAppDelivery, 'phone_number_id' | 'sender_key'>,
) {
  return `whatsapp:${workspace_id}:${conversation.phone_number_id}:${conversation.sender_key}`;
}

function group_by_conversation(deliveries: WhatsAppDelivery[]): ConversationDeliveries[] {
  const conversations = new Map<string, ConversationDeliveries>();
  deliveries.forEach((delivery) => {
    const key = `${delivery.phone_number_id}:${delivery.sender_key}`;
    const earlier = conversations.get(key);
    if (earlier) {
      earlier.push(delivery);
      return;
    }
    conversations.set(key, [delivery]);
  });
  return [...conversations.values()];
}

async function prepare_conversation_event(
  db: Database,
  event: VerifiedChannelEvent,
  deliveries: ConversationDeliveries,
): Promise<EnqueueEventInput | null> {
  const [first_delivery] = deliveries;
  const lookup = await find_whatsapp_route(db, first_delivery.phone_number_id);
  if (!lookup.found) {
    log.error('whatsapp event was not queued', {
      ...drop_details(event, lookup.reason),
      phone_number_id: first_delivery.phone_number_id,
    });
    return null;
  }

  const workspace_id = lookup.route.workspace_id;
  return {
    workspace_id,
    source: 'whatsapp',
    source_event_id: `message:${first_delivery.message.id}`,
    event_type: 'whatsapp.message',
    queue_key: whatsapp_queue_key(workspace_id, first_delivery),
    actor_key: `whatsapp:${first_delivery.sender_key}`,
    event_body: build_whatsapp_event_body(deliveries),
    raw_payload: {
      object: 'whatsapp_business_account',
      phone_number_id: first_delivery.phone_number_id,
      messages: deliveries.map((delivery) => delivery.message),
    },
    event_status: 'routed',
    event_jobs: [
      {
        job_handler: whatsapp_agent_message_handler,
        metadata: { [event_job_queue_barrier_metadata_key]: true },
      },
    ],
  };
}

function build_whatsapp_event_body(deliveries: ConversationDeliveries): WhatsAppEventBody {
  const [first_delivery] = deliveries;
  return {
    phone_number_id: first_delivery.phone_number_id,
    display_phone_number: first_delivery.display_phone_number,
    messages: deliveries.map(build_whatsapp_event_message),
  };
}

function drop_details(event: VerifiedChannelEvent, reason: string) {
  return {
    reason,
    provider_event_id: event.provider_event_id,
    provider_event_type: event.provider_event_type,
  };
}
