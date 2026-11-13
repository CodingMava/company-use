import type {
  WhatsAppDelivery,
  WhatsAppEventMessage,
  WhatsAppInboundMessage,
} from '@runtime-platform/channels/whatsapp/webhook_payloads';

type MessageTextReader = (message: WhatsAppInboundMessage) => string | undefined;

const text_by_message_type: Record<string, MessageTextReader> = {
  text: (message) => message.text?.body,
  button: (message) => message.button?.text,
  interactive: (message) =>
    message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title,
  location: (message) => message.location && describe_location(message.location),
};

const unopened_message_names: Record<string, string> = {
  image: 'a photo',
  video: 'a video',
  document: 'a document',
  audio: 'a voice message',
  sticker: 'a sticker',
  contacts: 'a contact card',
  unsupported: 'a kind of message WhatsApp does not pass on',
};

export function build_whatsapp_event_message(delivery: WhatsAppDelivery): WhatsAppEventMessage {
  const message = delivery.message;
  return {
    message_id: message.id,
    sender_key: delivery.sender_key,
    ...(delivery.sender_wa_id ? { sender_wa_id: delivery.sender_wa_id } : {}),
    ...(delivery.sender_user_id ? { sender_user_id: delivery.sender_user_id } : {}),
    ...(delivery.sender_name ? { sender_name: delivery.sender_name } : {}),
    message_type: message.type,
    message_text: whatsapp_message_text(message),
    sent_time: whatsapp_sent_time(message.timestamp),
  };
}

export function whatsapp_message_text(message: WhatsAppInboundMessage): string {
  const text = text_by_message_type[message.type]?.(message)?.trim();
  return text || describe_unopened_message(message);
}

export function whatsapp_turn_text(messages: WhatsAppEventMessage[]): string {
  return messages.map((message) => message.message_text).join('\n\n');
}

function describe_unopened_message(message: WhatsAppInboundMessage) {
  const name = unopened_message_names[message.type] ?? `a ${message.type} message`;
  const note = `[They sent ${name}, which this WhatsApp channel cannot open yet.]`;
  const caption = (message.image ?? message.video ?? message.document)?.caption?.trim();
  return caption ? `${note}\n${caption}` : note;
}

function describe_location(location: NonNullable<WhatsAppInboundMessage['location']>) {
  const place = [location.name, location.address].filter(Boolean).join(', ');
  const coordinates = `${location.latitude}, ${location.longitude}`;
  return place
    ? `[Shared a location: ${place} (${coordinates})]`
    : `[Shared a location: ${coordinates}]`;
}

function whatsapp_sent_time(timestamp_seconds: string) {
  const seconds = Number.parseInt(timestamp_seconds, 10);
  const sent = Number.isFinite(seconds) ? new Date(seconds * 1000) : new Date();
  return sent.toISOString();
}
