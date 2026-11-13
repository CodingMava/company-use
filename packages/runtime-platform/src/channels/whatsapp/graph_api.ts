import { env } from '@coworker/config';
import { AppError } from '@coworker/shared';
import { z } from 'zod';

export type WhatsAppGraphConfig = {
  access_token: string | undefined;
  api_version: string;
};

export type WhatsAppRecipient = { to: string } | { recipient: string };

const graph_api_origin = 'https://graph.facebook.com';
const graph_request_timeout_ms = 15_000;

const sent_message_schema = z.object({
  messages: z.array(z.object({ id: z.string().min(1) })).min(1),
});

const graph_error_schema = z.object({
  error: z.object({ message: z.string(), code: z.number().optional() }),
});

export function read_whatsapp_graph_config(): WhatsAppGraphConfig {
  return {
    access_token: env.WHATSAPP_ACCESS_TOKEN,
    api_version: env.WHATSAPP_GRAPH_API_VERSION,
  };
}

export async function send_whatsapp_text_message(
  config: WhatsAppGraphConfig,
  input: { phone_number_id: string; recipient: WhatsAppRecipient; body: string },
) {
  const payload = await post_whatsapp_message(config, input.phone_number_id, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    ...input.recipient,
    type: 'text',
    text: { preview_url: false, body: input.body },
  });
  const sent = sent_message_schema.safeParse(payload);
  const message_id = sent.success ? sent.data.messages[0]?.id : undefined;
  if (!message_id) {
    throw new AppError(
      'whatsapp_send_unconfirmed',
      'WhatsApp accepted the message without returning its id.',
      502,
    );
  }
  return { message_id };
}

export async function show_whatsapp_typing(
  config: WhatsAppGraphConfig,
  input: { phone_number_id: string; message_id: string },
) {
  await post_whatsapp_message(config, input.phone_number_id, {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: input.message_id,
    typing_indicator: { type: 'text' },
  });
}

async function post_whatsapp_message(
  config: WhatsAppGraphConfig,
  phone_number_id: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  if (!config.access_token) {
    throw new AppError(
      'whatsapp_access_token_missing',
      'WHATSAPP_ACCESS_TOKEN is not set, so the WhatsApp channel cannot send messages.',
      500,
    );
  }
  const path = `${config.api_version}/${encodeURIComponent(phone_number_id)}/messages`;
  const response = await fetch(`${graph_api_origin}/${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.access_token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(graph_request_timeout_ms),
  });
  const payload = await read_graph_payload(response);
  if (!response.ok) throw whatsapp_graph_error(response.status, payload);
  return payload;
}

async function read_graph_payload(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { unparsed_body: text.slice(0, 500) };
  }
}

function whatsapp_graph_error(status: number, payload: unknown) {
  const parsed = graph_error_schema.safeParse(payload);
  const error = parsed.success ? parsed.data.error : null;
  const detail = error
    ? `${error.message}${error.code === undefined ? '' : ` (code ${error.code})`}`
    : `HTTP ${status}`;
  return new AppError('whatsapp_send_failed', `WhatsApp refused the request: ${detail}`, 502, {
    http_status: status,
    ...(error?.code === undefined ? {} : { whatsapp_error_code: error.code }),
  });
}
