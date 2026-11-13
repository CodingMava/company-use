import type { Database } from '@coworker/core';
import { whatsapp_test_phone_number_id } from '@runtime-platform/channels/whatsapp/__tests__/whatsapp_fixtures';
import { find_whatsapp_route } from '@runtime-platform/channels/whatsapp/channel_route';
import { start_whatsapp_channel_turn } from '@runtime-platform/channels/whatsapp/channel_turn';
import { identify_whatsapp_sender } from '@runtime-platform/channels/whatsapp/sender_identity';
import { configure_agent_engine } from '@runtime-platform/orchestrator/agent_engine';
import { vi } from 'vitest';

export const whatsapp_test_graph = { access_token: 'whatsapp-test-token', api_version: 'v25.0' };

export type GraphCall = { url: string; body: Record<string, unknown> };

export function answer_every_turn_with(text: string) {
  configure_agent_engine(() => ({
    engine_name: 'agent-core/pi/whatsapp-turn-test',
    async *run() {
      yield { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text }] } };
    },
  }));
}

export function record_graph_calls(): GraphCall[] {
  const calls: GraphCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).startsWith('https://graph.facebook.com/')) {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      }
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.SENT' }] }), { status: 200 });
    }),
  );
  return calls;
}

export async function send_whatsapp_text(
  db: Database,
  input: { wa_id?: string; message_id?: string; text?: string } = {},
) {
  const lookup = await find_whatsapp_route(db, whatsapp_test_phone_number_id);
  if (!lookup.found) throw new Error(`route not found: ${lookup.reason}`);
  const wa_id = input.wa_id ?? '393331234567';
  const sender = await identify_whatsapp_sender(db, {
    route: lookup.route,
    address: { sender_key: wa_id, sender_wa_id: wa_id },
    profile_name: 'Giulia',
  });
  return start_whatsapp_channel_turn(db, {
    route: lookup.route,
    phone_number_id: whatsapp_test_phone_number_id,
    display_phone_number: '15550001111',
    sender,
    messages: [
      {
        message_id: input.message_id ?? 'wamid.ONE',
        sender_key: wa_id,
        sender_wa_id: wa_id,
        message_type: 'text',
        message_text: input.text ?? 'Any invoices overdue?',
        sent_time: '2026-11-09T10:00:00.000Z',
      },
    ],
    graph: whatsapp_test_graph,
  });
}

export async function send_accepted_whatsapp_text(
  db: Database,
  input: { wa_id?: string; message_id?: string; text?: string } = {},
) {
  const result = await send_whatsapp_text(db, input);
  if (!result.accepted) throw new Error(`the WhatsApp turn was refused: ${result.code}`);
  return result;
}
