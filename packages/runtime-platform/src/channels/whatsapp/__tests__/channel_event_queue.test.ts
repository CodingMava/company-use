import { env } from '@coworker/config';
import { events } from '@coworker/core/db/schema';
import {
  whatsapp_message_event,
  whatsapp_test_username_user_id,
  whatsapp_two_sender_webhook,
  whatsapp_username_webhook,
} from '@runtime-platform/channels/whatsapp/__tests__/whatsapp_fixtures';
import {
  add_whatsapp_route,
  create_second_workspace,
  create_workspace_with_whatsapp_route,
} from '@runtime-platform/channels/whatsapp/__tests__/whatsapp_workspace';
import { prepare_whatsapp_channel_event_jobs } from '@runtime-platform/channels/whatsapp/channel_event_queue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const original_env = { ...env };

describe('prepare_whatsapp_channel_event_jobs', () => {
  beforeEach(() => {
    Object.assign(env, {
      API_URL: 'http://api.test',
      COWORKER_API_PROXY_SECRET: 'configured-proxy-secret',
      EVENT_JOB_DISPATCH_MODE: 'http',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 202 })),
    );
  });

  afterEach(() => {
    Object.assign(env, original_env);
    vi.unstubAllGlobals();
  });

  it('queues a message for the workspace that owns the business number', async () => {
    const { db, workspace_id } = await create_workspace_with_whatsapp_route();

    const prepared = await prepare_whatsapp_channel_event_jobs(db, whatsapp_message_event());

    expect(prepared).toMatchObject({
      workspace_id,
      source: 'whatsapp',
      source_event_id: 'message:wamid.ONE',
      event_type: 'whatsapp.message',
      queue_key: `whatsapp:${workspace_id}:PNID_1:393331234567`,
      actor_key: 'whatsapp:393331234567',
      event_status: 'routed',
      event_body: {
        phone_number_id: 'PNID_1',
        display_phone_number: '15550001111',
        messages: [
          {
            message_id: 'wamid.ONE',
            sender_key: '393331234567',
            sender_wa_id: '393331234567',
            sender_name: 'Giulia',
            message_type: 'text',
            message_text: 'Any invoices overdue?',
          },
        ],
      },
    });
    expect(prepared?.event_jobs?.map((job) => job.job_handler)).toEqual(['whatsapp_agent_message']);
  });

  it('gives each sender in one webhook a queue of their own', async () => {
    const { db, workspace_id } = await create_workspace_with_whatsapp_route();

    const prepared = await prepare_whatsapp_channel_event_jobs(
      db,
      whatsapp_message_event({ raw_event: whatsapp_two_sender_webhook() }),
    );

    expect(prepared?.queue_key).toBe(`whatsapp:${workspace_id}:PNID_1:393331234567`);
    expect(prepared?.event_body?.messages).toEqual([
      expect.objectContaining({ message_id: 'wamid.GIULIA' }),
    ]);
    const queued = await db.select().from(events);
    expect(queued.map((event) => event.queue_key)).toEqual([
      `whatsapp:${workspace_id}:PNID_1:15557654321`,
    ]);
    expect(queued[0]?.event_body).toMatchObject({
      messages: [{ message_id: 'wamid.SAM', message_text: 'Hi there' }],
    });
    expect(JSON.stringify(queued[0]?.raw_payload)).not.toContain('wamid.GIULIA');
  });

  it('keys a username user, whose phone Meta hides, on their business-scoped id', async () => {
    const { db, workspace_id } = await create_workspace_with_whatsapp_route();

    const prepared = await prepare_whatsapp_channel_event_jobs(
      db,
      whatsapp_message_event({ raw_event: whatsapp_username_webhook() }),
    );

    expect(prepared).toMatchObject({
      queue_key: `whatsapp:${workspace_id}:PNID_1:${whatsapp_test_username_user_id}`,
      event_body: {
        messages: [
          {
            sender_key: whatsapp_test_username_user_id,
            sender_user_id: whatsapp_test_username_user_id,
            sender_name: 'Ana',
          },
        ],
      },
    });
    expect(prepared?.event_body?.messages).not.toContainEqual(
      expect.objectContaining({ sender_wa_id: expect.anything() }),
    );
  });

  it('drops a message for a business number no workspace has set up', async () => {
    const { db } = await create_workspace_with_whatsapp_route();

    const prepared = await prepare_whatsapp_channel_event_jobs(
      db,
      whatsapp_message_event({ phone_number_id: 'PNID_SOMEONE_ELSE' }),
    );

    expect(prepared).toBeNull();
  });

  it('drops a message while two workspaces claim the same business number', async () => {
    const { db, agent_id, user_id } = await create_workspace_with_whatsapp_route();
    const second = await create_second_workspace(db);
    await add_whatsapp_route(db, {
      workspace_id: second.workspace_id,
      agent_id,
      actor_id: user_id,
    });

    expect(await prepare_whatsapp_channel_event_jobs(db, whatsapp_message_event())).toBeNull();
  });

  it("drops a message while the route's settings are malformed", async () => {
    const { db } = await create_workspace_with_whatsapp_route({ member_phone_numbers: 'all' });

    expect(await prepare_whatsapp_channel_event_jobs(db, whatsapp_message_event())).toBeNull();
  });
});
