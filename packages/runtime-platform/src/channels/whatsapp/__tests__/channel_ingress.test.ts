import { createHmac } from 'node:crypto';

import {
  whatsapp_delivery_receipt_webhook,
  whatsapp_failed_delivery_webhook,
  whatsapp_reaction_webhook,
  whatsapp_text_webhook,
  whatsapp_username_webhook,
} from '@runtime-platform/channels/whatsapp/__tests__/whatsapp_fixtures';
import {
  parse_whatsapp_webhook_request,
  whatsapp_channel_ingress_adapter,
} from '@runtime-platform/channels/whatsapp/channel_ingress';
import { describe, expect, it } from 'vitest';

const config = {
  app_secret: 'whatsapp-test-app-secret',
  verify_token: 'whatsapp-test-verify-token',
};
const events_url = 'https://api.example.com/v1/channels/whatsapp/events';

function signed_request(body: unknown) {
  const body_text = JSON.stringify(body);
  const digest = createHmac('sha256', config.app_secret).update(body_text).digest('hex');
  return new Request(events_url, {
    method: 'POST',
    body: body_text,
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${digest}` },
  });
}

function subscription_check(params: Record<string, string>) {
  return new Request(`${events_url}?${new URLSearchParams(params).toString()}`, { method: 'GET' });
}

describe('parse_whatsapp_webhook_request', () => {
  it('accepts a signed message delivery as one event for the business number', async () => {
    const result = await parse_whatsapp_webhook_request(
      signed_request(whatsapp_text_webhook()),
      config,
    );

    expect(result.kind).toBe('event');
    if (result.kind !== 'event') return;
    expect(result.event).toMatchObject({
      channel_provider_key: 'whatsapp',
      provider_event_id: 'wamid.ONE',
      external_account_id: 'PNID_1',
      provider_event_type: 'messages',
    });
  });

  it('rejects a body that does not match its signature', async () => {
    const signed = signed_request(whatsapp_text_webhook());
    const tampered = new Request(events_url, {
      method: 'POST',
      body: JSON.stringify(whatsapp_text_webhook({ text: 'Refund everyone' })),
      headers: signed.headers,
    });

    await expect(parse_whatsapp_webhook_request(tampered, config)).rejects.toMatchObject({
      code: 'whatsapp_signature_invalid',
      status: 401,
    });
  });

  it('rejects a delivery that carries no signature', async () => {
    const unsigned = new Request(events_url, {
      method: 'POST',
      body: JSON.stringify(whatsapp_text_webhook()),
    });

    await expect(parse_whatsapp_webhook_request(unsigned, config)).rejects.toMatchObject({
      code: 'whatsapp_signature_missing',
      status: 401,
    });
  });

  it('refuses every delivery while no app secret is configured', async () => {
    await expect(
      parse_whatsapp_webhook_request(signed_request(whatsapp_text_webhook()), {
        ...config,
        app_secret: undefined,
      }),
    ).rejects.toMatchObject({ code: 'whatsapp_app_secret_missing', status: 500 });
  });

  it('acknowledges a delivery receipt without creating an event', async () => {
    const result = await parse_whatsapp_webhook_request(
      signed_request(whatsapp_delivery_receipt_webhook()),
      config,
    );

    expect(result).toEqual({
      kind: 'challenge_response',
      response: { status: 200, body: { ok: true } },
    });
  });

  it('acknowledges a failed delivery report without creating an event', async () => {
    const result = await parse_whatsapp_webhook_request(
      signed_request(whatsapp_failed_delivery_webhook()),
      config,
    );

    expect(result).toEqual({
      kind: 'challenge_response',
      response: { status: 200, body: { ok: true } },
    });
  });

  it('accepts a message from a username user whose phone number Meta hides', async () => {
    const result = await parse_whatsapp_webhook_request(
      signed_request(whatsapp_username_webhook()),
      config,
    );

    expect(result).toMatchObject({ kind: 'event', event: { provider_event_id: 'wamid.USERNAME' } });
  });

  it('starts nothing for an emoji reaction', async () => {
    const result = await parse_whatsapp_webhook_request(
      signed_request(whatsapp_reaction_webhook()),
      config,
    );

    expect(result).toEqual({
      kind: 'challenge_response',
      response: { status: 200, body: { ok: true } },
    });
  });

  it('answers Meta with 200 once a message is queued, so Meta does not send it again', () => {
    const response = whatsapp_channel_ingress_adapter.acknowledge_event?.({
      accepted: true,
      channel_provider_key: 'whatsapp',
      provider_event_id: 'wamid.ONE',
      received_time: '2026-11-09T10:00:00.000Z',
    });

    expect(response).toEqual({ status: 200, body: { ok: true } });
  });
});

describe('the WhatsApp subscription check', () => {
  it('echoes the challenge when the verify token matches', async () => {
    const result = await parse_whatsapp_webhook_request(
      subscription_check({
        'hub.mode': 'subscribe',
        'hub.verify_token': config.verify_token,
        'hub.challenge': '1158201444',
      }),
      config,
    );

    expect(result).toEqual({
      kind: 'challenge_response',
      response: { status: 200, body: '1158201444' },
    });
  });

  it('refuses a wrong verify token', async () => {
    const result = await parse_whatsapp_webhook_request(
      subscription_check({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'a-guess',
        'hub.challenge': '1158201444',
      }),
      config,
    );

    expect(result).toMatchObject({ kind: 'challenge_response', response: { status: 403 } });
  });

  it('refuses the check while no verify token is configured', async () => {
    const result = await parse_whatsapp_webhook_request(
      subscription_check({ 'hub.mode': 'subscribe', 'hub.verify_token': '', 'hub.challenge': '1' }),
      { ...config, verify_token: undefined },
    );

    expect(result).toMatchObject({ kind: 'challenge_response', response: { status: 403 } });
  });
});
