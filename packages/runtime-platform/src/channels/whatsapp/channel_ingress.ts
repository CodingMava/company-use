import { createHmac } from 'node:crypto';

import { env } from '@coworker/config';
import { AppError, create_logger, ValidationError } from '@coworker/shared';
import { secure_strings_equal } from '@coworker/shared/secure_strings_equal';
import type {
  ChannelHttpResponse,
  ChannelIngressAdapter,
  ChannelIngressResult,
} from '@runtime-platform/channels/channel_ingress';
import { prepare_whatsapp_channel_event_jobs } from '@runtime-platform/channels/whatsapp/channel_event_queue';
import {
  read_whatsapp_webhook,
  type WhatsAppWebhookContents,
} from '@runtime-platform/channels/whatsapp/webhook_contents';
import { whatsapp_webhook_body_schema } from '@runtime-platform/channels/whatsapp/webhook_payloads';

const log = create_logger('whatsapp_channel_ingress');

export type WhatsAppWebhookConfig = {
  app_secret: string | undefined;
  verify_token: string | undefined;
};

const signature_prefix = 'sha256=';

const received_response: ChannelHttpResponse = { status: 200, body: { ok: true } };

export const whatsapp_channel_ingress_adapter: ChannelIngressAdapter = {
  channel_provider_key: 'whatsapp',
  verify_and_parse_request: (request) =>
    parse_whatsapp_webhook_request(request, {
      app_secret: env.WHATSAPP_APP_SECRET,
      verify_token: env.WHATSAPP_VERIFY_TOKEN,
    }),
  acknowledge_event: () => received_response,
  prepare_event: prepare_whatsapp_channel_event_jobs,
};

export async function parse_whatsapp_webhook_request(
  request: Request,
  config: WhatsAppWebhookConfig,
): Promise<ChannelIngressResult> {
  if (request.method === 'GET') {
    return answer_subscription_check(new URL(request.url), config.verify_token);
  }
  const body_text = await request.text();
  verify_whatsapp_signature(request.headers.get('x-hub-signature-256'), body_text, config);
  const body = parse_whatsapp_webhook_body(body_text);
  const contents = read_whatsapp_webhook(body);
  log_what_will_not_be_answered(contents);
  const first_delivery = contents.deliveries[0];
  if (!first_delivery) return { kind: 'challenge_response', response: received_response };

  return {
    kind: 'event',
    event: {
      channel_provider_key: 'whatsapp',
      provider_event_id: first_delivery.message.id,
      received_time: new Date(),
      raw_event: body,
      external_account_id: first_delivery.phone_number_id,
      provider_event_type: 'messages',
    },
  };
}

function log_what_will_not_be_answered(contents: WhatsAppWebhookContents) {
  contents.failed_statuses.forEach((status) => {
    log.warn('whatsapp could not deliver a message this channel sent', {
      phone_number_id: status.phone_number_id,
      message_id: status.message_id,
      error_codes: status.errors.map((error) => error.code),
      error_titles: status.errors.map((error) => error.title ?? ''),
    });
  });
  if (contents.unreadable_message_count > 0) {
    log.warn('whatsapp webhook carried messages this channel could not read', {
      unreadable_message_count: contents.unreadable_message_count,
    });
  }
}

function answer_subscription_check(
  url: URL,
  verify_token: string | undefined,
): ChannelIngressResult {
  const challenge = url.searchParams.get('hub.challenge');
  const subscribing = url.searchParams.get('hub.mode') === 'subscribe';
  const offered_token = url.searchParams.get('hub.verify_token');
  if (!subscribing || !challenge || !verify_token_matches(offered_token, verify_token)) {
    return {
      kind: 'challenge_response',
      response: { status: 403, body: { error: 'whatsapp_verify_token_mismatch' } },
    };
  }
  return { kind: 'challenge_response', response: { status: 200, body: challenge } };
}

function verify_token_matches(offered_token: string | null, verify_token: string | undefined) {
  if (!offered_token || !verify_token) return false;
  return secure_strings_equal(offered_token, verify_token);
}

export function verify_whatsapp_signature(
  signature_header: string | null,
  body_text: string,
  config: Pick<WhatsAppWebhookConfig, 'app_secret'>,
) {
  if (!config.app_secret) {
    throw new AppError(
      'whatsapp_app_secret_missing',
      'WHATSAPP_APP_SECRET is required to receive WhatsApp messages.',
      500,
    );
  }
  if (!signature_header?.startsWith(signature_prefix)) {
    throw new AppError('whatsapp_signature_missing', 'X-Hub-Signature-256 is required.', 401);
  }
  const expected = createHmac('sha256', config.app_secret).update(body_text).digest('hex');
  const provided = signature_header.slice(signature_prefix.length).toLowerCase();
  if (!secure_strings_equal(provided, expected)) {
    throw new AppError('whatsapp_signature_invalid', 'X-Hub-Signature-256 is invalid.', 401);
  }
}

function parse_whatsapp_webhook_body(body_text: string) {
  const parsed = whatsapp_webhook_body_schema.safeParse(parse_json(body_text));
  if (!parsed.success) {
    throw new ValidationError('WhatsApp webhook body failed validation', parsed.error.flatten());
  }
  return parsed.data;
}

function parse_json(body_text: string): unknown {
  try {
    return JSON.parse(body_text);
  } catch {
    throw new ValidationError('WhatsApp webhook body must be valid JSON');
  }
}
