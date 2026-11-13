import type { VerifiedChannelEvent } from '@runtime-platform/channels/channel_ingress';

export const whatsapp_test_phone_number_id = 'PNID_1';
export const whatsapp_test_sender_wa_id = '393331234567';
export const whatsapp_test_username_user_id = 'US.13491208655302741918';

export function whatsapp_change(value: Record<string, unknown>) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'WABA_1', changes: [{ field: 'messages', value }] }],
  };
}

function business_number(phone_number_id = whatsapp_test_phone_number_id) {
  return {
    messaging_product: 'whatsapp',
    metadata: { display_phone_number: '15550001111', phone_number_id },
  };
}

export function whatsapp_text_message(
  input: { from?: string; message_id?: string; text?: string } = {},
) {
  return {
    from: input.from ?? whatsapp_test_sender_wa_id,
    id: input.message_id ?? 'wamid.ONE',
    timestamp: '1762700000',
    type: 'text',
    text: { body: input.text ?? 'Any invoices overdue?' },
  };
}

export function whatsapp_text_webhook(
  input: { phone_number_id?: string; message_id?: string; text?: string } = {},
) {
  return whatsapp_change({
    ...business_number(input.phone_number_id),
    contacts: [{ wa_id: whatsapp_test_sender_wa_id, profile: { name: 'Giulia' } }],
    messages: [whatsapp_text_message(input)],
  });
}

export function whatsapp_username_webhook() {
  return whatsapp_change({
    ...business_number(),
    contacts: [{ user_id: whatsapp_test_username_user_id, profile: { name: 'Ana' } }],
    messages: [
      {
        from_user_id: whatsapp_test_username_user_id,
        id: 'wamid.USERNAME',
        timestamp: '1762700000',
        type: 'text',
        text: { body: 'Are you open Saturday?' },
      },
    ],
  });
}

export function whatsapp_reaction_webhook() {
  return whatsapp_change({
    ...business_number(),
    contacts: [{ wa_id: whatsapp_test_sender_wa_id, profile: { name: 'Giulia' } }],
    messages: [
      {
        from: whatsapp_test_sender_wa_id,
        id: 'wamid.REACTION',
        timestamp: '1762700000',
        type: 'reaction',
        reaction: { message_id: 'wamid.REPLY', emoji: '+1' },
      },
    ],
  });
}

export function whatsapp_two_sender_webhook() {
  return whatsapp_change({
    ...business_number(),
    contacts: [
      { wa_id: whatsapp_test_sender_wa_id, profile: { name: 'Giulia' } },
      { wa_id: '15557654321', profile: { name: 'Sam' } },
    ],
    messages: [
      whatsapp_text_message({ message_id: 'wamid.GIULIA' }),
      whatsapp_text_message({ from: '15557654321', message_id: 'wamid.SAM', text: 'Hi there' }),
    ],
  });
}

export function whatsapp_delivery_receipt_webhook() {
  return whatsapp_change({
    ...business_number(),
    statuses: [{ id: 'wamid.SENT', status: 'delivered', recipient_id: whatsapp_test_sender_wa_id }],
  });
}

export function whatsapp_failed_delivery_webhook() {
  return whatsapp_change({
    ...business_number(),
    statuses: [
      {
        id: 'wamid.SENT',
        status: 'failed',
        recipient_id: whatsapp_test_sender_wa_id,
        errors: [{ code: 131047, title: 'Re-engagement message' }],
      },
    ],
  });
}

export function whatsapp_message_event(
  input: {
    phone_number_id?: string;
    message_id?: string;
    raw_event?: VerifiedChannelEvent['raw_event'];
  } = {},
): VerifiedChannelEvent {
  return {
    channel_provider_key: 'whatsapp',
    provider_event_id: input.message_id ?? 'wamid.ONE',
    received_time: new Date('2026-11-09T10:00:00.000Z'),
    provider_event_type: 'messages',
    external_account_id: input.phone_number_id ?? whatsapp_test_phone_number_id,
    raw_event: input.raw_event ?? whatsapp_text_webhook(input),
  };
}
