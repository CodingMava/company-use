import { createHmac } from 'node:crypto';

import { env } from '@coworker/config';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_channel } from '@coworker/core/db/queries/channels';
import { afterEach, describe, expect, it, vi } from 'vitest';

const app_secret = 'whatsapp-test-app-secret';
const verify_token = 'whatsapp-test-verify-token';

const original_config = {
  API_URL: env.API_URL,
  COWORKER_API_PROXY_SECRET: env.COWORKER_API_PROXY_SECRET,
  EVENT_JOB_DISPATCH_MODE: env.EVENT_JOB_DISPATCH_MODE,
  WHATSAPP_APP_SECRET: env.WHATSAPP_APP_SECRET,
  WHATSAPP_VERIFY_TOKEN: env.WHATSAPP_VERIFY_TOKEN,
};

const message_body = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'WABA_1',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '15550001111', phone_number_id: 'PNID_1' },
            contacts: [{ wa_id: '393331234567', profile: { name: 'Giulia' } }],
            messages: [
              {
                from: '393331234567',
                id: 'wamid.ROUTE',
                timestamp: '1762700000',
                type: 'text',
                text: { body: 'Any invoices overdue?' },
              },
            ],
          },
        },
      ],
    },
  ],
});

function signature_of(body: string) {
  return `sha256=${createHmac('sha256', app_secret).update(body).digest('hex')}`;
}

async function create_app_with_whatsapp_route() {
  Object.assign(env, {
    API_URL: 'http://api.test',
    COWORKER_API_PROXY_SECRET: 'configured-proxy-secret',
    EVENT_JOB_DISPATCH_MODE: 'http',
    WHATSAPP_APP_SECRET: app_secret,
    WHATSAPP_VERIFY_TOKEN: verify_token,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('ok')),
  );
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  await create_channel(db, {
    workspace_id: bootstrap.workspace_id,
    channel_provider_key: 'whatsapp',
    external_account_id: 'PNID_1',
    target_kind: 'agent',
    target_id: bootstrap.agent_id,
    actor_id: bootstrap.user_id,
  });
  const { create_app } = await import('@api/app');
  return { db, bootstrap, app: create_app(db) };
}

describe('whatsapp channel event route', () => {
  afterEach(() => {
    Object.assign(env, original_config);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('queues the agent-message job for a signed message and answers Meta with 200', async () => {
    const { db, bootstrap, app } = await create_app_with_whatsapp_route();

    const response = await app.request('/v1/channels/whatsapp/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': signature_of(message_body),
      },
      body: message_body,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const [event] = await db.query.events.findMany({
      where: (table, { eq }) => eq(table.source_event_id, 'message:wamid.ROUTE'),
    });
    expect(event).toMatchObject({
      workspace_id: bootstrap.workspace_id,
      event_status: 'routed',
      queue_key: `whatsapp:${bootstrap.workspace_id}:PNID_1:393331234567`,
    });
    const jobs = await db.query.event_jobs.findMany({
      where: (table, { eq }) => eq(table.event_id, event?.event_id ?? ''),
    });
    expect(jobs.map((job) => job.job_handler)).toEqual(['whatsapp_agent_message']);
  });

  it('answers 200 and stores nothing for a number no workspace has set up', async () => {
    const { db, app } = await create_app_with_whatsapp_route();
    const unrouted_body = message_body.replace('PNID_1', 'PNID_UNKNOWN');

    const response = await app.request('/v1/channels/whatsapp/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': signature_of(unrouted_body),
      },
      body: unrouted_body,
    });

    expect(response.status).toBe(200);
    expect(await db.query.events.findMany()).toEqual([]);
  });

  it('refuses a message whose signature does not match', async () => {
    const { db, app } = await create_app_with_whatsapp_route();

    const response = await app.request('/v1/channels/whatsapp/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature_of('{}') },
      body: message_body,
    });

    expect(response.status).toBe(401);
    expect(await db.query.events.findMany()).toEqual([]);
  });

  it("answers Meta's subscription check with the challenge", async () => {
    const { app } = await create_app_with_whatsapp_route();

    const response = await app.request(
      `/v1/channels/whatsapp/events?hub.mode=subscribe&hub.verify_token=${verify_token}&hub.challenge=1158201444`,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('1158201444');
  });
});
