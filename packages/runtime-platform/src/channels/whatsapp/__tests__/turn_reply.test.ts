import { send_whatsapp_reply } from '@runtime-platform/channels/whatsapp/turn_reply';
import { afterEach, describe, expect, it, vi } from 'vitest';

const graph = { access_token: 'whatsapp-test-token', api_version: 'v25.0' };
const target = {
  phone_number_id: 'PNID_1',
  sender_key: '393331234567',
  sender_wa_id: '393331234567',
};

function stub_graph_api(responses: Array<{ status: number; body: unknown }>) {
  const queued = [...responses];
  const fetch_stub = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const next = queued.shift() ?? { status: 500, body: { error: { message: 'unexpected call' } } };
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetch_stub);
  return fetch_stub;
}

function sent_bodies(fetch_stub: ReturnType<typeof stub_graph_api>) {
  return fetch_stub.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
}

describe('send_whatsapp_reply', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the reply as WhatsApp text from the business number', async () => {
    const fetch_stub = stub_graph_api([{ status: 200, body: { messages: [{ id: 'wamid.R1' }] } }]);

    const sent = await send_whatsapp_reply(graph, target, '**Two** invoices are overdue.');

    expect(sent).toEqual(['wamid.R1']);
    expect(fetch_stub).toHaveBeenCalledWith(
      'https://graph.facebook.com/v25.0/PNID_1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer whatsapp-test-token' }),
      }),
    );
    expect(sent_bodies(fetch_stub)).toEqual([
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: '393331234567',
        type: 'text',
        text: { preview_url: false, body: '*Two* invoices are overdue.' },
      },
    ]);
  });

  it('answers a username user, whose phone Meta hides, by their business-scoped id', async () => {
    const fetch_stub = stub_graph_api([{ status: 200, body: { messages: [{ id: 'wamid.R1' }] } }]);

    await send_whatsapp_reply(
      graph,
      { phone_number_id: 'PNID_1', sender_key: 'US.13491208655302741918' },
      'We open at 9.',
    );

    const [body] = sent_bodies(fetch_stub);
    expect(body).toMatchObject({ recipient: 'US.13491208655302741918' });
    expect(body).not.toHaveProperty('to');
  });

  it('sends a reply longer than one WhatsApp message as parts, in order', async () => {
    const fetch_stub = stub_graph_api([
      { status: 200, body: { messages: [{ id: 'wamid.R1' }] } },
      { status: 200, body: { messages: [{ id: 'wamid.R2' }] } },
    ]);
    const paragraph = 'invoice '.repeat(300).trim();

    const sent = await send_whatsapp_reply(graph, target, `${paragraph}\n\n${paragraph}`);

    expect(sent).toEqual(['wamid.R1', 'wamid.R2']);
    expect(sent_bodies(fetch_stub).map((body) => body.text.body)).toEqual([paragraph, paragraph]);
  });

  it('names the WhatsApp error when Meta refuses the message', async () => {
    stub_graph_api([
      { status: 400, body: { error: { message: 'Re-engagement message', code: 131047 } } },
    ]);

    const reply = send_whatsapp_reply(graph, target, 'Your refund is approved.');

    await expect(reply).rejects.toMatchObject({
      code: 'whatsapp_send_failed',
      message: 'WhatsApp refused the request: Re-engagement message (code 131047)',
    });
  });

  it('refuses to send without an access token', async () => {
    const fetch_stub = stub_graph_api([]);

    await expect(
      send_whatsapp_reply({ ...graph, access_token: undefined }, target, 'Hello'),
    ).rejects.toMatchObject({ code: 'whatsapp_access_token_missing' });
    expect(fetch_stub).not.toHaveBeenCalled();
  });
});
