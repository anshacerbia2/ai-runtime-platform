import type { ContractKind } from '../validation/types.js';

export const examples: {
  id: string;
  title: string;
  kind: ContractKind;
  payload: unknown;
}[] = [
  {
    id: 'chat',
    title: 'Direct chat',
    kind: 'chat',
    payload: {
      profile: 'chat-default@1',
      input: {
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Jelaskan apa yang dimiliki app dan platform.',
              },
            ],
          },
        ],
      },
      stream: true,
    },
  },
  {
    id: 'structured',
    title: 'Structured output',
    kind: 'generate',
    payload: {
      profile: 'fare-interpretation@1',
      capability: 'structured_generate',
      context: { process_id: 'fare-123', step_id: 'interpret' },
      input: {
        prompt: 'Klasifikasikan aturan berikut.',
        response_schema: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              enum: ['allowed', 'restricted', 'unknown'],
            },
          },
          required: ['category'],
          additionalProperties: false,
        },
      },
      stream: false,
    },
  },
  {
    id: 'scribe',
    title: 'Scribe agent',
    kind: 'execution',
    payload: {
      profile: 'scribe-document@2',
      capability: 'agent_execute',
      context: { process_id: 'scribe-job-123', step_id: 'generate-document' },
      input: {
        prompt: 'Buat draft sesuai standar dokumen.',
        artifact_refs: ['artifact-video-123', 'artifact-standard-v3'],
      },
    },
  },
  {
    id: 'invalid',
    title: 'Identity spoofing',
    kind: 'chat',
    payload: {
      profile: 'chat-default@1',
      application_id: 'another-app',
      input: {
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Identitas ini harus ditolak.' }],
          },
        ],
      },
    },
  },
];
