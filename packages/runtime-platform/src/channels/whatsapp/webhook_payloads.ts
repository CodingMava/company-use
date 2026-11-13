import { z } from 'zod';

const media_schema = z.object({
  caption: z.string().optional(),
  filename: z.string().optional(),
});

export const whatsapp_inbound_message_schema = z.object({
  from: z.string().min(1).optional(),
  from_user_id: z.string().min(1).optional(),
  id: z.string().min(1),
  timestamp: z.string().min(1),
  type: z.string().min(1),
  text: z.object({ body: z.string() }).optional(),
  image: media_schema.optional(),
  video: media_schema.optional(),
  document: media_schema.optional(),
  button: z.object({ text: z.string() }).optional(),
  interactive: z
    .object({
      button_reply: z.object({ title: z.string() }).optional(),
      list_reply: z.object({ title: z.string() }).optional(),
    })
    .optional(),
  location: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
      name: z.string().optional(),
      address: z.string().optional(),
    })
    .optional(),
});

export type WhatsAppInboundMessage = z.infer<typeof whatsapp_inbound_message_schema>;

export const whatsapp_contact_schema = z.object({
  wa_id: z.string().min(1).optional(),
  user_id: z.string().min(1).optional(),
  profile: z.object({ name: z.string().optional() }).optional(),
});

export type WhatsAppContact = z.infer<typeof whatsapp_contact_schema>;

export const whatsapp_failed_status_schema = z.object({
  id: z.string().min(1),
  status: z.literal('failed'),
  errors: z.array(z.object({ code: z.number(), title: z.string().optional() })).default([]),
});

export const whatsapp_change_value_schema = z.object({
  messaging_product: z.literal('whatsapp'),
  metadata: z.object({
    display_phone_number: z.string(),
    phone_number_id: z.string().min(1),
  }),
  contacts: z.array(z.unknown()).default([]),
  messages: z.array(z.unknown()).default([]),
  statuses: z.array(z.unknown()).default([]),
});

export type WhatsAppChangeValue = z.infer<typeof whatsapp_change_value_schema>;

export const whatsapp_webhook_body_schema = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z
    .array(
      z.object({
        changes: z.array(z.object({ field: z.string(), value: z.unknown() })).default([]),
      }),
    )
    .default([]),
});

export type WhatsAppWebhookBody = z.infer<typeof whatsapp_webhook_body_schema>;

const sender_address_fields = {
  sender_key: z.string().min(1),
  sender_wa_id: z.string().min(1).optional(),
  sender_user_id: z.string().min(1).optional(),
};

export type WhatsAppSenderAddress = {
  sender_key: string;
  sender_wa_id?: string | undefined;
  sender_user_id?: string | undefined;
};

export const whatsapp_event_message_schema = z.object({
  message_id: z.string().min(1),
  ...sender_address_fields,
  sender_name: z.string().optional(),
  message_type: z.string().min(1),
  message_text: z.string(),
  sent_time: z.string(),
});

export type WhatsAppEventMessage = z.infer<typeof whatsapp_event_message_schema>;

export const whatsapp_event_body_schema = z.object({
  phone_number_id: z.string().min(1),
  display_phone_number: z.string(),
  messages: z.array(whatsapp_event_message_schema).min(1),
});

export type WhatsAppEventBody = z.infer<typeof whatsapp_event_body_schema>;

export type WhatsAppDelivery = WhatsAppSenderAddress & {
  phone_number_id: string;
  display_phone_number: string;
  sender_name?: string | undefined;
  message: WhatsAppInboundMessage;
};

export const whatsapp_session_target_schema = z.object({
  phone_number_id: z.string().min(1),
  display_phone_number: z.string(),
  ...sender_address_fields,
});

export type WhatsAppSessionTarget = z.infer<typeof whatsapp_session_target_schema>;

export const whatsapp_turn_metadata_schema = whatsapp_session_target_schema.extend({
  sender_is_workspace_member: z.boolean(),
  message_ids: z.array(z.string().min(1)),
});

export type WhatsAppTurnMetadata = z.infer<typeof whatsapp_turn_metadata_schema>;

const whatsapp_source_metadata_schema = z.object({ whatsapp: whatsapp_turn_metadata_schema });

export function read_whatsapp_turn_metadata(source_metadata: unknown): WhatsAppTurnMetadata | null {
  const parsed = whatsapp_source_metadata_schema.safeParse(source_metadata);
  return parsed.success ? parsed.data.whatsapp : null;
}

export function build_whatsapp_session_target(
  number: { phone_number_id: string; display_phone_number: string },
  address: WhatsAppSenderAddress,
): WhatsAppSessionTarget {
  return {
    phone_number_id: number.phone_number_id,
    display_phone_number: number.display_phone_number,
    sender_key: address.sender_key,
    ...(address.sender_wa_id ? { sender_wa_id: address.sender_wa_id } : {}),
    ...(address.sender_user_id ? { sender_user_id: address.sender_user_id } : {}),
  };
}
