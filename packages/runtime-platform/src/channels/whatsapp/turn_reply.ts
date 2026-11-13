import {
  send_whatsapp_text_message,
  type WhatsAppGraphConfig,
  type WhatsAppRecipient,
} from '@runtime-platform/channels/whatsapp/graph_api';
import {
  format_whatsapp_text,
  split_whatsapp_text,
} from '@runtime-platform/channels/whatsapp/message_format';
import type { WhatsAppSessionTarget } from '@runtime-platform/channels/whatsapp/webhook_payloads';

export type WhatsAppReplyTarget = Pick<
  WhatsAppSessionTarget,
  'phone_number_id' | 'sender_key' | 'sender_wa_id'
>;

export async function send_whatsapp_reply(
  graph: WhatsAppGraphConfig,
  target: WhatsAppReplyTarget,
  text: string,
): Promise<string[]> {
  return send_chunks_in_order(graph, target, split_whatsapp_text(format_whatsapp_text(text)));
}

export function whatsapp_recipient(target: WhatsAppReplyTarget): WhatsAppRecipient {
  return target.sender_wa_id ? { to: target.sender_wa_id } : { recipient: target.sender_key };
}

async function send_chunks_in_order(
  graph: WhatsAppGraphConfig,
  target: WhatsAppReplyTarget,
  chunks: string[],
): Promise<string[]> {
  const [chunk, ...later_chunks] = chunks;
  if (chunk === undefined) return [];
  const sent = await send_whatsapp_text_message(graph, {
    phone_number_id: target.phone_number_id,
    recipient: whatsapp_recipient(target),
    body: chunk,
  });
  return [sent.message_id, ...(await send_chunks_in_order(graph, target, later_chunks))];
}
