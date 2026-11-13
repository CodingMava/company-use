import { get_session, list_run_messages } from '@coworker/core/db/queries/sessions';
import { sessions, source_actors } from '@coworker/core/db/schema';
import {
  answer_every_turn_with,
  record_graph_calls,
  send_accepted_whatsapp_text,
  send_whatsapp_text,
} from '@runtime-platform/channels/whatsapp/__tests__/whatsapp_turn_harness';
import {
  change_whatsapp_route_settings,
  create_workspace_with_whatsapp_route,
  listed_founder,
} from '@runtime-platform/channels/whatsapp/__tests__/whatsapp_workspace';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('start_whatsapp_channel_turn', () => {
  beforeEach(() => {
    answer_every_turn_with('Two invoices are overdue.');
    vi.stubEnv('OPENAI_API_KEY', 'sk-test-never-sent');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('answers nobody it does not know while the number is closed', async () => {
    const { db } = await create_workspace_with_whatsapp_route(listed_founder);
    const calls = record_graph_calls();

    const result = await send_whatsapp_text(db, { wa_id: '15557654321' });

    expect(result).toMatchObject({ accepted: false, code: 'sender_not_a_member' });
    expect(await db.select().from(sessions)).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('answers a listed teammate in a chat of their own', async () => {
    const { db, workspace_id, user_id } =
      await create_workspace_with_whatsapp_route(listed_founder);
    const calls = record_graph_calls();

    const result = await send_accepted_whatsapp_text(db);

    const session = await get_session(db, workspace_id, result.session_id);
    expect(session?.external_thread_key).toBe(
      `whatsapp:${workspace_id}:PNID_1:393331234567:${user_id}`,
    );
    expect(calls.map((call) => call.body)).toEqual([
      expect.objectContaining({ status: 'read', message_id: 'wamid.ONE' }),
      expect.objectContaining({
        to: '393331234567',
        text: { preview_url: false, body: 'Two invoices are overdue.' },
      }),
    ]);
    const messages = await list_run_messages(db, workspace_id, result.run_id);
    const opening = messages.find((message) => message.message_role === 'user');
    expect(opening?.source_metadata).toMatchObject({
      whatsapp: { sender_key: '393331234567', sender_is_workspace_member: true },
    });
  });

  it('answers an outside sender only when the route allows it', async () => {
    const { db, workspace_id } = await create_workspace_with_whatsapp_route({
      answer_outside_senders: true,
    });
    record_graph_calls();

    const result = await send_accepted_whatsapp_text(db, { wa_id: '15557654321' });

    const session = await get_session(db, workspace_id, result.session_id);
    expect(session?.external_thread_key).toBe(
      `whatsapp:${workspace_id}:PNID_1:15557654321:outside`,
    );
    const messages = await list_run_messages(db, workspace_id, result.run_id);
    const opening = messages.find((message) => message.message_role === 'user');
    expect(opening?.source_metadata).toMatchObject({
      whatsapp: { sender_is_workspace_member: false },
    });
  });

  it('opens a new chat, without the old identity, when a number leaves the list', async () => {
    const { db, workspace_id } = await create_workspace_with_whatsapp_route({
      ...listed_founder,
      answer_outside_senders: true,
    });
    record_graph_calls();
    const as_member = await send_accepted_whatsapp_text(db);

    await change_whatsapp_route_settings(db, workspace_id, { answer_outside_senders: true });
    const as_outsider = await send_accepted_whatsapp_text(db, { message_id: 'wamid.TWO' });

    expect(as_outsider.session_id).not.toBe(as_member.session_id);
    const [speaker] = await db
      .select()
      .from(source_actors)
      .where(eq(source_actors.external_id, '393331234567'));
    expect(speaker?.provider).toBe('whatsapp');
    expect(speaker?.email ?? null).toBeNull();
  });
});
