import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { workspace_members } from '@coworker/core/db/schema';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

const whatsapp_route = {
  channel_provider_key: 'whatsapp',
  external_account_id: 'PNID_1',
  channel_config: { member_phone_numbers: { '+39 333 123 4567': 'giulia@acme.com' } },
};

async function create_app_for(member_role = 'owner') {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  await db
    .update(workspace_members)
    .set({ member_role })
    .where(eq(workspace_members.user_id, bootstrap.user_id));
  return { db, app: create_app(db) };
}

async function send(
  app: ReturnType<typeof create_app>,
  method: string,
  path: string,
  body?: unknown,
) {
  const response = await app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

describe('the WhatsApp route settings', () => {
  it.each(['member', 'viewer'])('refuses the %s role on every door', async (member_role) => {
    const { db, app } = await create_app_for(member_role);

    const attempts = [
      await send(app, 'GET', '/v1/channels'),
      await send(app, 'POST', '/v1/channels', whatsapp_route),
      await send(app, 'PATCH', '/v1/channels/chn_any', { channel_status: 'disabled' }),
    ];

    expect(attempts.map((attempt) => attempt.status)).toEqual([403, 403, 403]);
    expect(attempts.map((attempt) => attempt.body.error?.code)).toEqual([
      'channel_access_denied',
      'channel_access_denied',
      'channel_access_denied',
    ]);
    expect(await db.query.channels.findMany()).toEqual([]);
  });

  it('stores the phone list tidied', async () => {
    const { app } = await create_app_for();

    const created = await send(app, 'POST', '/v1/channels', {
      ...whatsapp_route,
      channel_config: { member_phone_numbers: { '+39 333 123 4567': ' Giulia@Acme.com ' } },
    });

    expect(created.status).toBe(201);
    expect(created.body.data.channel_config).toEqual({
      member_phone_numbers: { '+39 333 123 4567': 'giulia@acme.com' },
      answer_outside_senders: false,
    });
  });

  it('refuses settings with a mistyped value and says which', async () => {
    const { db, app } = await create_app_for();

    const refused = await send(app, 'POST', '/v1/channels', {
      ...whatsapp_route,
      channel_config: { ...whatsapp_route.channel_config, answer_outside_senders: 'false' },
    });

    expect(refused.status).toBe(422);
    expect(refused.body.error?.message).toContain('answer_outside_senders');
    expect(await db.query.channels.findMany()).toEqual([]);
  });

  it('refuses a second enabled route for the same number', async () => {
    const { app } = await create_app_for();
    const first = await send(app, 'POST', '/v1/channels', whatsapp_route);

    const second = await send(app, 'POST', '/v1/channels', whatsapp_route);

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(second.body.error?.message).toContain(first.body.data.channel_id);
  });

  it('changes the phone list on the route that exists', async () => {
    const { app } = await create_app_for();
    const created = await send(app, 'POST', '/v1/channels', whatsapp_route);
    const member_phone_numbers = {
      '+39 333 123 4567': 'giulia@acme.com',
      '+39 333 765 4321': 'marco@acme.com',
    };

    const changed = await send(app, 'PATCH', `/v1/channels/${created.body.data.channel_id}`, {
      channel_config: { member_phone_numbers },
    });

    expect(changed.status).toBe(200);
    expect(changed.body.data).toMatchObject({
      channel_status: 'enabled',
      channel_config: { member_phone_numbers, answer_outside_senders: false },
    });
  });
});
