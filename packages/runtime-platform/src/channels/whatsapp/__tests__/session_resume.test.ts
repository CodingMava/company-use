import { env } from '@coworker/config';
import { get_session } from '@coworker/core/db/queries/sessions';
import { runs } from '@coworker/core/db/schema';
import {
  answer_every_turn_with,
  type GraphCall,
  record_graph_calls,
  send_accepted_whatsapp_text,
} from '@runtime-platform/channels/whatsapp/__tests__/whatsapp_turn_harness';
import {
  change_whatsapp_route_settings,
  create_workspace_with_whatsapp_route,
  listed_founder,
} from '@runtime-platform/channels/whatsapp/__tests__/whatsapp_workspace';
import { continue_the_whatsapp_turn_that_asked } from '@runtime-platform/channels/whatsapp/session_resume';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const original_access_token = env.WHATSAPP_ACCESS_TOKEN;

async function a_whatsapp_chat_that_asked() {
  const workspace = await create_workspace_with_whatsapp_route(listed_founder);
  const calls = record_graph_calls();
  const asked = await send_accepted_whatsapp_text(workspace.db);
  const session = await get_session(workspace.db, workspace.workspace_id, asked.session_id);
  if (!session) throw new Error('the WhatsApp session is missing');
  calls.length = 0;
  return { ...workspace, calls, session, asking_run_id: asked.run_id };
}

function continue_after_approval(
  chat: Awaited<ReturnType<typeof a_whatsapp_chat_that_asked>>,
  asking_run_id: string,
) {
  return continue_the_whatsapp_turn_that_asked(chat.db, {
    workspace_id: chat.workspace_id,
    session: chat.session,
    asking_run_id,
    job_id: 'job_approval',
    job: {},
  });
}

function sent_texts(calls: GraphCall[]) {
  return calls.flatMap((call) => {
    const text = call.body.text;
    return text && typeof text === 'object' && 'body' in text ? [text.body] : [];
  });
}

describe('continue_the_whatsapp_turn_that_asked', () => {
  beforeEach(() => {
    answer_every_turn_with('The invoice went out.');
    vi.stubEnv('OPENAI_API_KEY', 'sk-test-never-sent');
    Object.assign(env, { WHATSAPP_ACCESS_TOKEN: 'whatsapp-test-token' });
  });

  afterEach(() => {
    Object.assign(env, { WHATSAPP_ACCESS_TOKEN: original_access_token });
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('brings the approved answer back to the WhatsApp sender who asked', async () => {
    const chat = await a_whatsapp_chat_that_asked();

    const run_id = await continue_after_approval(chat, chat.asking_run_id);

    expect(run_id).toEqual(expect.any(String));
    expect(chat.calls.map((call) => call.body.to)).toEqual(['393331234567']);
    expect(sent_texts(chat.calls)).toEqual(['The invoice went out.']);
  });

  it('leaves the answer to a teammate request from the dashboard in the dashboard', async () => {
    const chat = await a_whatsapp_chat_that_asked();
    const [dashboard_run] = await chat.db
      .insert(runs)
      .values({
        run_id: 'run_dashboard_request',
        workspace_id: chat.workspace_id,
        session_id: chat.session.session_id,
        agent_id: chat.agent_id,
        run_status: 'waiting',
        created_by: chat.user_id,
        last_updated_by: chat.user_id,
      })
      .returning();

    const run_id = await continue_after_approval(chat, dashboard_run?.run_id ?? '');

    expect(run_id).toBeNull();
    expect(chat.calls).toEqual([]);
  });

  it('sends nothing to a number that was taken off the list', async () => {
    const chat = await a_whatsapp_chat_that_asked();
    await change_whatsapp_route_settings(chat.db, chat.workspace_id, {});

    const run_id = await continue_after_approval(chat, chat.asking_run_id);

    expect(run_id).toBeNull();
    expect(chat.calls).toEqual([]);
  });
});
