import { has_scheduled_task_run_authority } from '@coworker/core';
import { read_trusted_email_turn_context } from '@runtime-platform/channels/email/event_payloads';
import { read_trusted_whatsapp_turn_context } from '@runtime-platform/channels/whatsapp/trusted_turn_context';
import type { RuntimeToolSourceContext } from '@runtime-platform/tools/types';

type SystemRun = {
  actor_id: string;
  source_context?: RuntimeToolSourceContext | undefined;
};

const human_authority_checks: ((run: SystemRun) => boolean)[] = [
  scheduled_task_was_authorized,
  email_came_from_a_proven_member,
  whatsapp_came_from_a_listed_member,
];

/**
 * A run no person started may change something outside the workspace only when a person
 * stands behind it: someone authorized this exact scheduled task, or a workspace member the
 * channel proved: by an email the mail provider authenticated, or a WhatsApp number an admin listed.
 */
export function system_run_has_human_authority(run: SystemRun) {
  return human_authority_checks.some((check) => check(run));
}

function scheduled_task_was_authorized(run: SystemRun) {
  return (
    run.actor_id === 'system:trigger' &&
    has_scheduled_task_run_authority(run.source_context?.source_metadata)
  );
}

function email_came_from_a_proven_member(run: SystemRun) {
  return (
    run.actor_id === 'system:email' &&
    read_trusted_email_turn_context(run.source_context)?.sender_is_workspace_member === true
  );
}

function whatsapp_came_from_a_listed_member(run: SystemRun) {
  return (
    run.actor_id === 'system:whatsapp' &&
    read_trusted_whatsapp_turn_context(run.source_context)?.sender_is_workspace_member === true
  );
}
