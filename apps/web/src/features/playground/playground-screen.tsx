'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { PageHeader } from '../../design-system/compositions/page-header';
import {
  Panel,
  PanelBody,
  PanelHeader,
} from '../../design-system/components/panel';
import { Badge, type BadgeTone } from '../../design-system/components/badge';
import { Button } from '../../design-system/primitives/button';
import { ApiClientError, isRequestAborted } from '../../shared/api/http-error';
import {
  cancelExecution,
  streamChat,
  type ChatStreamUpdate,
  type PlaygroundMessage,
} from './chat-stream';

type RunState = 'idle' | 'streaming' | 'completed' | 'failed' | 'cancelled';

interface RunInfo {
  executionId: string | null;
  provider: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  finishReason: string | null;
}

const emptyRun: RunInfo = {
  executionId: null,
  provider: null,
  model: null,
  inputTokens: null,
  outputTokens: null,
  finishReason: null,
};

const stateTone: Record<RunState, BadgeTone> = {
  idle: 'neutral',
  streaming: 'info',
  completed: 'success',
  failed: 'danger',
  cancelled: 'warning',
};

export function PlaygroundScreen() {
  const [profile, setProfile] = useState('playground-chat');
  const [system, setSystem] = useState('');
  const [maxOutputTokens, setMaxOutputTokens] = useState(1024);
  const [messages, setMessages] = useState<PlaygroundMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [state, setState] = useState<RunState>('idle');
  const [run, setRun] = useState<RunInfo>(emptyRun);
  const [error, setError] = useState<ApiClientError | Error | null>(null);
  const controller = useRef<AbortController | null>(null);
  const transcript = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    transcript.current?.scrollTo({ top: transcript.current.scrollHeight });
  }, [messages]);
  useEffect(() => () => controller.current?.abort(), []);

  const streaming = state === 'streaming';

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || streaming) {
      return;
    }
    const history: PlaygroundMessage[] = [...messages, { role: 'user', text }];
    setMessages([...history, { role: 'assistant', text: '' }]);
    setDraft('');
    setError(null);
    setRun(emptyRun);
    setState('streaming');
    const abort = new AbortController();
    controller.current = abort;
    const apply = (update: ChatStreamUpdate) => {
      switch (update.kind) {
        case 'started':
          setRun((current) => ({
            ...current,
            executionId: update.executionId,
            provider: update.provider,
            model: update.model,
          }));
          break;
        case 'delta':
          setMessages((current) => {
            const next = [...current];
            const last = next[next.length - 1];
            next[next.length - 1] = { ...last, text: last.text + update.text };
            return next;
          });
          break;
        case 'usage':
          setRun((current) => ({
            ...current,
            inputTokens: update.inputTokens,
            outputTokens: update.outputTokens,
          }));
          break;
        case 'completed':
          setRun((current) => ({
            ...current,
            finishReason: update.finishReason,
          }));
          setState('completed');
          break;
        case 'failed':
          setError(new Error('The execution failed: ' + update.code + '.'));
          setState('failed');
          break;
        case 'cancelled':
          setState('cancelled');
          break;
      }
    };
    try {
      await streamChat(
        {
          profile,
          system,
          messages: history,
          maxOutputTokens,
          signal: abort.signal,
        },
        apply,
      );
      setState((current) => (current === 'streaming' ? 'completed' : current));
    } catch (cause) {
      if (isRequestAborted(cause)) {
        setState('cancelled');
      } else {
        setError(cause instanceof Error ? cause : new Error(String(cause)));
        setState('failed');
      }
    } finally {
      controller.current = null;
      // Drop an empty assistant bubble left by a failed turn.
      setMessages((current) =>
        current.length && current[current.length - 1].text === ''
          ? current.slice(0, -1)
          : current,
      );
    }
  }

  async function stop() {
    const executionId = run.executionId;
    controller.current?.abort();
    if (executionId) {
      // Durable cancel intent; the provider call stops asynchronously.
      await cancelExecution(executionId).catch(() => undefined);
    }
  }

  function reset() {
    controller.current?.abort();
    setMessages([]);
    setRun(emptyRun);
    setError(null);
    setState('idle');
  }

  return (
    <>
      <PageHeader
        eyebrow="Workbench"
        title="AI Playground"
        description="Chat with a model through the platform gateway: the same admission, budget, streaming and usage path your applications use."
        meta={<Badge tone={stateTone[state]}>{state}</Badge>}
      />
      <div className="playground-layout">
        <Panel className="playground-chat">
          <PanelHeader
            title="Conversation"
            description="Each turn sends the whole conversation as one gateway execution."
            aside={
              <Button
                size="sm"
                variant="ghost"
                onClick={reset}
                disabled={!messages.length && !error}
              >
                Clear
              </Button>
            }
          />
          <div
            className="playground-transcript"
            ref={transcript}
            aria-live="polite"
          >
            {messages.length ? (
              messages.map((message, index) => (
                <article
                  key={index}
                  className={`playground-message is-${message.role}`}
                >
                  <span className="playground-role">{message.role}</span>
                  <p>
                    {message.text ||
                      (streaming && index === messages.length - 1 ? '…' : '')}
                  </p>
                </article>
              ))
            ) : (
              <p className="playground-empty">
                Send a message to start. Replies stream in as the model writes
                them.
              </p>
            )}
          </div>
          {error ? <PlaygroundError error={error} profile={profile} /> : null}
          <form className="playground-composer" onSubmit={send}>
            <textarea
              aria-label="Message"
              rows={3}
              value={draft}
              placeholder="Ask something…"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <div className="playground-actions">
              {streaming ? (
                <Button type="button" variant="danger" onClick={stop}>
                  Stop
                </Button>
              ) : (
                <Button
                  type="submit"
                  variant="primary"
                  disabled={!draft.trim()}
                >
                  Send
                </Button>
              )}
            </div>
          </form>
        </Panel>
        <div className="playground-side">
          <Panel>
            <PanelHeader title="Settings" />
            <PanelBody>
              <div className="playground-fields">
                <label className="ds-field">
                  <span>Profile</span>
                  <input
                    value={profile}
                    onChange={(event) => setProfile(event.target.value)}
                    disabled={streaming}
                  />
                </label>
                <label className="ds-field">
                  <span>Max output tokens</span>
                  <input
                    type="number"
                    min={1}
                    max={32768}
                    value={maxOutputTokens}
                    onChange={(event) =>
                      setMaxOutputTokens(
                        Math.min(
                          32768,
                          Math.max(1, Number(event.target.value) || 1),
                        ),
                      )
                    }
                    disabled={streaming}
                  />
                </label>
                <label className="ds-field">
                  <span>System prompt</span>
                  <textarea
                    rows={4}
                    value={system}
                    placeholder="Optional instructions for the model"
                    onChange={(event) => setSystem(event.target.value)}
                    disabled={streaming}
                  />
                </label>
              </div>
            </PanelBody>
          </Panel>
          <Panel>
            <PanelHeader title="Last execution" />
            <PanelBody>
              <dl className="playground-facts">
                <dt>Execution</dt>
                <dd>{run.executionId ?? '—'}</dd>
                <dt>Provider</dt>
                <dd>{run.provider ?? '—'}</dd>
                <dt>Model</dt>
                <dd>{run.model ?? '—'}</dd>
                <dt>Input tokens</dt>
                <dd>{tokens(run.inputTokens, run.executionId)}</dd>
                <dt>Output tokens</dt>
                <dd>{tokens(run.outputTokens, run.executionId)}</dd>
                <dt>Finish</dt>
                <dd>{run.finishReason ?? '—'}</dd>
              </dl>
            </PanelBody>
          </Panel>
        </div>
      </div>
    </>
  );
}

function tokens(value: number | null, executionId: string | null) {
  if (value !== null) {
    return value.toLocaleString();
  }
  // Unknown usage is shown as unknown, never as zero.
  return executionId ? 'unknown' : '—';
}

function PlaygroundError({
  error,
  profile,
}: {
  error: Error;
  profile: string;
}) {
  const code = error instanceof ApiClientError ? error.code : null;
  const setup =
    code === 'NOT_FOUND' ||
    code === 'POLICY_DENIED' ||
    code === 'VERSION_UNSUPPORTED' ||
    /CREDENTIAL|PROVIDER/.test(code ?? error.message);
  return (
    <div className="playground-error" role="alert">
      <strong>{code ?? 'Request failed'}</strong>
      <p>
        {error instanceof ApiClientError ? error.serverMessage : error.message}
      </p>
      {setup ? (
        <p>
          Profile <code>{profile}</code> may not be provisioned yet. Set{' '}
          <code>M2_ANTHROPIC_API_KEY</code> or{' '}
          <code>M2_OPENROUTER_API_KEY</code> in <code>.env</code>, run{' '}
          <code>npm run db:migrate</code>, then restart <code>npm run dev</code>
          .
        </p>
      ) : null}
    </div>
  );
}
