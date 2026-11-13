import type { Database } from '@coworker/core';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { get_run } from '@coworker/core/db/queries/sessions';
import { runs, tool_calls } from '@coworker/core/db/schema';
import {
  finalize_whatsapp_channel_turn,
  whatsapp_waiting_for_approval_text,
} from '@runtime-platform/channels/whatsapp/turn_finalize';
import { afterEach, describe, expect, it, vi } from 'vitest';

const workspace_id = 'ws_finalize';

async function seed_run(db: Database, run_status: string, held_step_status?: string) {
  const [run] = await db
    .insert(runs)
    .values({
      run_id: `run_${Math.random().toString(36).slice(2, 10)}`,
      workspace_id,
      session_id: 'sess_waiting',
      agent_id: 'agent_1',
      run_status,
      created_by: 'system:test',
      last_updated_by: 'system:test',
    })
    .returning();
  if (!run) throw new Error('run seed failed');
  if (held_step_status) {
    await db.insert(tool_calls).values({
      tool_call_id: `tc_${run.run_id}`,
      workspace_id,
      session_id: 'sess_waiting',
      run_id: run.run_id,
      tool_name: 'email-send-1',
      tool_status: held_step_status,
      created_by: 'system:test',
      last_updated_by: 'system:test',
    });
  }
  return run;
}

function finalize_input(run: { run_id: string; run_status: string }, member = true) {
  return {
    workspace_id,
    session_id: 'sess_waiting',
    run_id: run.run_id,
    run_status: run.run_status,
    turn: {
      phone_number_id: 'PNID_1',
      display_phone_number: '15550001111',
      sender_key: '393331234567',
      sender_wa_id: '393331234567',
      sender_is_workspace_member: member,
      message_ids: ['wamid.ONE'],
    },
    graph: { access_token: 'whatsapp-test-token', api_version: 'v25.0' },
    actor_id: 'system:whatsapp',
    finalized_by: 'whatsapp_turn_finalize_test',
  };
}

function record_sent_texts(status = 200) {
  const texts: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      texts.push(JSON.parse(String(init?.body)).text.body);
      const body =
        status === 200 ? { messages: [{ id: 'wamid.SENT' }] } : { error: { message: 'down' } };
      return new Response(JSON.stringify(body), { status });
    }),
  );
  return texts;
}

describe('finalize_whatsapp_channel_turn', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('tells a teammate where a held step waits for its approval', async () => {
    const db = await create_test_database();
    const texts = record_sent_texts();
    const run = await seed_run(db, 'waiting', 'awaiting_approval');

    const result = await finalize_whatsapp_channel_turn(db, finalize_input(run));

    const waiting_prefix = `${whatsapp_waiting_for_approval_text} It is waiting here: `;
    expect(result).toEqual({ outcome: 'sent_waiting_notice' });
    expect(texts).toHaveLength(1);
    expect(texts[0]?.startsWith(waiting_prefix)).toBe(true);
    expect(texts[0]).toMatch(/\/chats\/sess_waiting$/u);
  });

  it('sends an outside sender no link into the workspace', async () => {
    const db = await create_test_database();
    const texts = record_sent_texts();
    const run = await seed_run(db, 'waiting', 'awaiting_approval');

    await finalize_whatsapp_channel_turn(db, finalize_input(run, false));

    expect(texts).toEqual([whatsapp_waiting_for_approval_text]);
  });

  it('closes the turn normally when the approval came in while the run still waited', async () => {
    const db = await create_test_database();
    const texts = record_sent_texts();
    const run = await seed_run(db, 'waiting', 'completed');

    const result = await finalize_whatsapp_channel_turn(db, finalize_input(run));

    expect(result).toEqual({ outcome: 'sent_unresolved_notice' });
    expect(texts[0]).not.toContain(whatsapp_waiting_for_approval_text);
  });

  it('tells the sender when the run failed', async () => {
    const db = await create_test_database();
    const texts = record_sent_texts();
    const run = await seed_run(db, 'failed');

    const result = await finalize_whatsapp_channel_turn(db, finalize_input(run));

    expect(result).toEqual({ outcome: 'sent_run_failure_notice' });
    expect(texts[0]).toMatch(/^Something went wrong/u);
  });

  it('stays quiet for a cancelled run', async () => {
    const db = await create_test_database();
    const texts = record_sent_texts();
    const run = await seed_run(db, 'cancelled');

    const result = await finalize_whatsapp_channel_turn(db, finalize_input(run));

    expect(result).toEqual({ outcome: 'cancelled_without_notice' });
    expect(texts).toEqual([]);
  });

  it('sends one closing message even when the turn is finalized twice', async () => {
    const db = await create_test_database();
    const texts = record_sent_texts();
    const run = await seed_run(db, 'waiting', 'awaiting_approval');

    await finalize_whatsapp_channel_turn(db, finalize_input(run));
    const second = await finalize_whatsapp_channel_turn(db, {
      ...finalize_input(run),
      run_status: 'completed',
    });

    expect(second).toEqual({ outcome: 'already_finalized' });
    expect(texts).toHaveLength(1);
  });

  it('records a reply WhatsApp refused as send_failed', async () => {
    const db = await create_test_database();
    record_sent_texts(500);
    const run = await seed_run(db, 'failed');

    const result = await finalize_whatsapp_channel_turn(db, finalize_input(run));

    expect(result).toEqual({ outcome: 'send_failed' });
    const stored = await get_run(db, workspace_id, run.run_id);
    expect(stored?.run_metadata).toMatchObject({ turn_finalize: { outcome: 'send_failed' } });
  });
});
