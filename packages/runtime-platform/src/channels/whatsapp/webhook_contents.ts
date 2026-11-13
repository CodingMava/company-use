import {
  type WhatsAppChangeValue,
  type WhatsAppContact,
  type WhatsAppDelivery,
  type WhatsAppInboundMessage,
  type WhatsAppWebhookBody,
  whatsapp_change_value_schema,
  whatsapp_contact_schema,
  whatsapp_failed_status_schema,
  whatsapp_inbound_message_schema,
} from '@runtime-platform/channels/whatsapp/webhook_payloads';

const non_conversational_message_types = new Set(['reaction', 'system', 'request_welcome']);

export type WhatsAppFailedStatus = {
  phone_number_id: string;
  message_id: string;
  errors: { code: number; title?: string | undefined }[];
};

export type WhatsAppWebhookContents = {
  deliveries: WhatsAppDelivery[];
  failed_statuses: WhatsAppFailedStatus[];
  unreadable_message_count: number;
};

export function read_whatsapp_webhook(body: WhatsAppWebhookBody): WhatsAppWebhookContents {
  const contents = list_message_change_values(body).map(read_change_value);
  return {
    deliveries: contents.flatMap((value) => value.deliveries),
    failed_statuses: contents.flatMap((value) => value.failed_statuses),
    unreadable_message_count: contents.reduce(
      (count, value) => count + value.unreadable_message_count,
      0,
    ),
  };
}

export function list_whatsapp_deliveries(body: WhatsAppWebhookBody): WhatsAppDelivery[] {
  return read_whatsapp_webhook(body).deliveries;
}

function list_message_change_values(body: WhatsAppWebhookBody): WhatsAppChangeValue[] {
  return body.entry.flatMap((entry) =>
    entry.changes.flatMap((change) => {
      if (change.field !== 'messages') return [];
      const value = whatsapp_change_value_schema.safeParse(change.value);
      return value.success ? [value.data] : [];
    }),
  );
}

function read_change_value(value: WhatsAppChangeValue): WhatsAppWebhookContents {
  const contacts = value.contacts.flatMap((candidate) => {
    const contact = whatsapp_contact_schema.safeParse(candidate);
    return contact.success ? [contact.data] : [];
  });
  const parsed = value.messages.map((candidate) =>
    whatsapp_inbound_message_schema.safeParse(candidate),
  );
  const conversational = parsed.flatMap((message) =>
    message.success && !non_conversational_message_types.has(message.data.type)
      ? [message.data]
      : [],
  );
  const ignored_count = parsed.filter(
    (message) => message.success && non_conversational_message_types.has(message.data.type),
  ).length;
  const deliveries = conversational.flatMap((message) => build_delivery(value, contacts, message));
  return {
    deliveries,
    failed_statuses: list_failed_statuses(value),
    unreadable_message_count: parsed.length - ignored_count - deliveries.length,
  };
}

function build_delivery(
  value: WhatsAppChangeValue,
  contacts: WhatsAppContact[],
  message: WhatsAppInboundMessage,
): WhatsAppDelivery[] {
  const sender_key = message.from_user_id ?? message.from;
  if (!sender_key) return [];
  const contact = contacts.find((entry) => contact_sent_message(entry, message));
  const sender_wa_id = message.from ?? contact?.wa_id;
  const sender_name = contact?.profile?.name?.trim();
  return [
    {
      phone_number_id: value.metadata.phone_number_id,
      display_phone_number: value.metadata.display_phone_number,
      sender_key,
      ...(sender_wa_id ? { sender_wa_id } : {}),
      ...(message.from_user_id ? { sender_user_id: message.from_user_id } : {}),
      ...(sender_name ? { sender_name } : {}),
      message,
    },
  ];
}

function contact_sent_message(contact: WhatsAppContact, message: WhatsAppInboundMessage) {
  if (message.from_user_id && contact.user_id) return contact.user_id === message.from_user_id;
  return message.from !== undefined && contact.wa_id === message.from;
}

function list_failed_statuses(value: WhatsAppChangeValue): WhatsAppFailedStatus[] {
  return value.statuses.flatMap((candidate) => {
    const status = whatsapp_failed_status_schema.safeParse(candidate);
    if (!status.success) return [];
    return [
      {
        phone_number_id: value.metadata.phone_number_id,
        message_id: status.data.id,
        errors: status.data.errors,
      },
    ];
  });
}
