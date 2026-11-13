import {
  build_whatsapp_event_message,
  whatsapp_turn_text,
} from '@runtime-platform/channels/whatsapp/inbound_text';
import type {
  WhatsAppDelivery,
  WhatsAppInboundMessage,
} from '@runtime-platform/channels/whatsapp/webhook_payloads';
import { describe, expect, it } from 'vitest';

function delivery(message: Omit<WhatsAppInboundMessage, 'from' | 'id' | 'timestamp'>) {
  const whatsapp_delivery: WhatsAppDelivery = {
    phone_number_id: 'PNID_1',
    display_phone_number: '15550001111',
    sender_key: '393331234567',
    sender_wa_id: '393331234567',
    sender_name: 'Giulia',
    message: { from: '393331234567', id: 'wamid.ONE', timestamp: '1762700000', ...message },
  };
  return whatsapp_delivery;
}

describe('build_whatsapp_event_message', () => {
  it('keeps the text, the sender and the time WhatsApp stamped', () => {
    expect(
      build_whatsapp_event_message(
        delivery({ type: 'text', text: { body: '  Any invoices overdue?  ' } }),
      ),
    ).toEqual({
      message_id: 'wamid.ONE',
      sender_key: '393331234567',
      sender_wa_id: '393331234567',
      sender_name: 'Giulia',
      message_type: 'text',
      message_text: 'Any invoices overdue?',
      sent_time: '2025-11-09T14:53:20.000Z',
    });
  });

  it('reads the title of a tapped reply button', () => {
    const message = build_whatsapp_event_message(
      delivery({ type: 'interactive', interactive: { button_reply: { title: 'Approve' } } }),
    );

    expect(message.message_text).toBe('Approve');
  });

  it('describes a photo it cannot open and keeps its caption', () => {
    const message = build_whatsapp_event_message(
      delivery({ type: 'image', image: { caption: 'Receipt from lunch' } }),
    );

    expect(message.message_text).toBe(
      '[They sent a photo, which this WhatsApp channel cannot open yet.]\nReceipt from lunch',
    );
  });

  it('names a message WhatsApp would not pass on in plain words', () => {
    const message = build_whatsapp_event_message(delivery({ type: 'unsupported' }));

    expect(message.message_text).toBe(
      '[They sent a kind of message WhatsApp does not pass on, which this WhatsApp channel cannot open yet.]',
    );
  });

  it('describes a shared location', () => {
    const message = build_whatsapp_event_message(
      delivery({
        type: 'location',
        location: { latitude: 45.46, longitude: 9.19, name: 'Warehouse' },
      }),
    );

    expect(message.message_text).toBe('[Shared a location: Warehouse (45.46, 9.19)]');
  });
});

describe('whatsapp_turn_text', () => {
  it('joins a burst of messages into one turn', () => {
    const first = build_whatsapp_event_message(delivery({ type: 'text', text: { body: 'hi' } }));
    const second = build_whatsapp_event_message(
      delivery({ type: 'text', text: { body: 'can you chase Acme?' } }),
    );

    expect(whatsapp_turn_text([first, second])).toBe('hi\n\ncan you chase Acme?');
  });
});
