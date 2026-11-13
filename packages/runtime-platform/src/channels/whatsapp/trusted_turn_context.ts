import {
  read_whatsapp_turn_metadata,
  type WhatsAppTurnMetadata,
} from '@runtime-platform/channels/whatsapp/webhook_payloads';
import type { RuntimeToolSourceContext } from '@runtime-platform/tools/types';

export function read_trusted_whatsapp_turn_context(
  source_context?: RuntimeToolSourceContext,
): WhatsAppTurnMetadata | null {
  if (source_context?.source_type !== 'whatsapp') return null;
  return read_whatsapp_turn_metadata(source_context.source_metadata);
}
