import { channel_reply_sections } from '@runtime-platform/orchestrator/context/channel_reply_protocols';
import { format_current_turn_context } from '@runtime-platform/orchestrator/context/current_turn_context';
import { build_model_visible_current_turn_context } from '@runtime-platform/orchestrator/current_turn_context';
import { describe, expect, it } from 'vitest';

describe('the WhatsApp turn context', () => {
  it('tells the model who is writing and that an outside sender gives no instructions', () => {
    const text = format_current_turn_context({
      source_type: 'whatsapp',
      whatsapp: {
        business_phone: '15550001111',
        speaker_name: 'Sam',
        speaker_phone: '+15557654321',
        sender_is_workspace_member: false,
      },
    });

    expect(text).toContain("source: WhatsApp — a person just messaged this workspace's number");
    expect(text).toContain('speaking_with: Sam (WhatsApp +15557654321)');
    expect(text).toContain('NOT a member of this workspace');
  });

  it('builds the context from the metadata a WhatsApp turn carries', () => {
    const context = build_model_visible_current_turn_context({
      session_id: 'sess_1',
      source_type: 'whatsapp',
      user_message_source_metadata: {
        whatsapp: {
          phone_number_id: 'PNID_1',
          display_phone_number: '15550001111',
          sender_wa_id: '393331234567',
          sender_is_workspace_member: true,
          message_ids: ['wamid.ONE'],
        },
      },
    });

    expect(context).toMatchObject({
      source_type: 'whatsapp',
      whatsapp: {
        business_phone: '15550001111',
        speaker_phone: '+393331234567',
        sender_is_workspace_member: true,
      },
    });
  });

  it('adds the WhatsApp reply protocol for every WhatsApp turn', () => {
    const [protocol] = channel_reply_sections('whatsapp');

    expect(protocol?.text).toContain('## WhatsApp Reply Protocol');
    expect(protocol).not.toHaveProperty('steers_tools');
  });
});
