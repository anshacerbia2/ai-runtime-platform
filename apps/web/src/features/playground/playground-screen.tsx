'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  agentRunLimits,
  agentToolNames,
  type AgentRunEvent,
  type AgentToolName,
} from '@ai-runtime/contracts/http';
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
import {
  applyAgentEvent,
  streamAgentRun,
  type AgentStep,
} from './agent-stream';

type Mode = 'chat' | 'agent';
type RunState = 'idle' | 'streaming' | 'completed' | 'failed' | 'cancelled';

interface TranscriptMessage extends PlaygroundMessage {
  steps?: AgentStep[];
}

interface RunInfo {
  kind: Mode;
  id: string | null;
  provider: string | null;
  model: string | null;
  steps: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  outcome: string | null;
}

const emptyRun: RunInfo = {
  kind: 'chat',
  id: null,
  provider: null,
  model: null,
  steps: null,
  inputTokens: null,
  outputTokens: null,
  outcome: null,
};

const stateTone: Record<RunState, BadgeTone> = {
  idle: 'neutral',
  streaming: 'info',
  completed: 'success',
  failed: 'danger',
  cancelled: 'warning',
};

const toolLabels: Record<AgentToolName, string> = {
  current_time: 'Current time',
  calculate: 'Calculator',
  execution_lookup: 'Execution lookup',
};

/** A run that ended without an answer, carrying the server's stop code. */
class RunStopError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function PlaygroundScreen() {
  const [mode, setMode] = useState<Mode>('chat');
  const [profile, setProfile] = useState('playground-chat');
  const [system, setSystem] = useState('');
  const [maxOutputTokens, setMaxOutputTokens] = useState(1024);
  const [maxSteps, setMaxSteps] = useState<number>(agentRunLimits.defaultSteps);
  const [tools, setTools] = useState<AgentToolName[]>([...agentToolNames]);
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [state, setState] = useState<RunState>('idle');
  const [run, setRun] = useState<RunInfo>(emptyRun);
  const [error, setError] = useState<Error | null>(null);
  const controller = useRef<AbortController | null>(null);
  const transcript = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    transcript.current?.scrollTo({ top: transcript.current.scrollHeight });
  }, [messages]);
  useEffect(() => () => controller.current?.abort(), []);

  const streaming = state === 'streaming';

  function updateLast(change: (last: TranscriptMessage) => TranscriptMessage) {
    setMessages((current) => {
      const last = current[current.length - 1];
      return last ? [...current.slice(0, -1), change(last)] : current;
    });
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || streaming) {
      return;
    }
    const prior = messages.map(({ role, text: body }) => ({
      role,
      text: body,
    }));
    setMessages([
      ...messages,
      { role: 'user', text },
      {
        role: 'assistant',
        text: '',
        ...(mode === 'agent' ? { steps: [] } : {}),
      },
    ]);
    setDraft('');
    setError(null);
    setRun({ ...emptyRun, kind: mode });
    setState('streaming');
    const abort = new AbortController();
    controller.current = abort;
    try {
      if (mode === 'agent') {
        await streamAgentRun(
          {
            profile,
            input: text,
            system,
            history: prior,
            tools,
            maxSteps,
            maxOutputTokens,
            signal: abort.signal,
          },
          applyAgent,
        );
      } else {
        await streamChat(
          {
            profile,
            system,
            messages: [...prior, { role: 'user', text }],
            maxOutputTokens,
            signal: abort.signal,
          },
          applyChat,
        );
      }
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
      // Drop an assistant bubble that never received anything.
      setMessages((current) => {
        const last = current[current.length - 1];
        return last && last.text === '' && !last.steps?.length
          ? current.slice(0, -1)
          : current;
      });
    }
  }

  function applyChat(update: ChatStreamUpdate) {
    switch (update.kind) {
      case 'started':
        setRun((current) => ({
          ...current,
          id: update.executionId,
          provider: update.provider,
          model: update.model,
        }));
        break;
      case 'delta':
        updateLast((last) => ({ ...last, text: last.text + update.text }));
        break;
      case 'usage':
        setRun((current) => ({
          ...current,
          inputTokens: update.inputTokens,
          outputTokens: update.outputTokens,
        }));
        break;
      case 'completed':
        setRun((current) => ({ ...current, outcome: update.finishReason }));
        setState('completed');
        break;
      case 'failed':
        setError(new RunStopError(update.code, 'The execution failed.'));
        setState('failed');
        break;
      case 'cancelled':
        setState('cancelled');
        break;
    }
  }

  function applyAgent(event: AgentRunEvent) {
    switch (event.type) {
      case 'run.started':
        setRun((current) => ({ ...current, id: event.run_id }));
        break;
      case 'run.completed':
        updateLast((last) => ({ ...last, text: event.payload.answer }));
        setRun((current) => ({
          ...current,
          steps: event.payload.steps,
          inputTokens: event.payload.input_tokens,
          outputTokens: event.payload.output_tokens,
          outcome: 'COMPLETED',
        }));
        setState('completed');
        break;
      case 'run.stopped':
        setRun((current) => ({
          ...current,
          steps: event.payload.steps,
          inputTokens: event.payload.input_tokens,
          outputTokens: event.payload.output_tokens,
          outcome: event.payload.status,
        }));
        if (event.payload.status === 'CANCELLED') {
          setState('cancelled');
        } else {
          setError(new RunStopError(event.payload.code, event.payload.message));
          setState('failed');
        }
        break;
      default:
        updateLast((last) => ({
          ...last,
          steps: applyAgentEvent(last.steps ?? [], event),
        }));
    }
  }

  async function stop() {
    const id = run.kind === 'chat' ? run.id : null;
    // For an agent run, closing the stream cancels it server-side.
    controller.current?.abort();
    if (id) {
      // Durable cancel intent; the provider call stops asynchronously.
      await cancelExecution(id).catch(() => undefined);
    }
  }

  function reset() {
    controller.current?.abort();
    setMessages([]);
    setRun(emptyRun);
    setError(null);
    setState('idle');
  }

  function toggleTool(name: AgentToolName) {
    setTools((current) =>
      current.includes(name)
        ? current.filter((tool) => tool !== name)
        : agentToolNames.filter(
            (tool) => tool === name || current.includes(tool),
          ),
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Workbench"
        title="AI Playground"
        description="Chat with a model, or let an agent use tools, through the platform gateway: the same admission, budget and usage path your applications use."
        meta={<Badge tone={stateTone[state]}>{state}</Badge>}
      />
      <div className="playground-layout">
        <Panel className="playground-chat">
          <PanelHeader
            title={mode === 'agent' ? 'Agent' : 'Conversation'}
            description={
              mode === 'agent'
                ? 'The model may call tools, read their results and then answer. Every model step is one gateway execution.'
                : 'Each turn sends the whole conversation as one gateway execution.'
            }
            aside={
              <div className="playground-header-actions">
                <div
                  className="playground-mode"
                  role="group"
                  aria-label="Playground mode"
                >
                  {(['chat', 'agent'] as const).map((value) => (
                    <Button
                      key={value}
                      size="sm"
                      variant={mode === value ? 'primary' : 'ghost'}
                      aria-pressed={mode === value}
                      disabled={streaming}
                      onClick={() => setMode(value)}
                    >
                      {value === 'chat' ? 'Chat' : 'Agent'}
                    </Button>
                  ))}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={reset}
                  disabled={!messages.length && !error}
                >
                  Clear
                </Button>
              </div>
            }
          />
          <div
            className="playground-transcript"
            ref={transcript}
            aria-live="polite"
          >
            {messages.length ? (
              messages.map((message, index) => {
                const live = streaming && index === messages.length - 1;
                return (
                  <article
                    key={index}
                    className={`playground-message is-${message.role}`}
                  >
                    <span className="playground-role">{message.role}</span>
                    {message.steps ? (
                      <AgentSteps steps={message.steps} live={live} />
                    ) : null}
                    <p>
                      {message.text ||
                        (live
                          ? message.steps
                            ? 'Working…'
                            : '…'
                          : message.steps
                            ? 'No answer.'
                            : '')}
                    </p>
                  </article>
                );
              })
            ) : (
              <p className="playground-empty">
                {mode === 'agent'
                  ? 'Give the agent a task, such as "What is 18% of 2,450 AUD?" or "What time is it in Jakarta and in Sydney?".'
                  : 'Send a message to start. Replies stream in as the model writes them.'}
              </p>
            )}
          </div>
          {error ? <PlaygroundError error={error} profile={profile} /> : null}
          <form className="playground-composer" onSubmit={send}>
            <textarea
              aria-label="Message"
              rows={3}
              value={draft}
              placeholder={
                mode === 'agent' ? 'Give the agent a task…' : 'Ask something…'
              }
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
                  {mode === 'agent' ? 'Run agent' : 'Send'}
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
                  <span>
                    Max output tokens{mode === 'agent' ? ' per step' : ''}
                  </span>
                  <input
                    type="number"
                    min={64}
                    max={8192}
                    value={maxOutputTokens}
                    onChange={(event) =>
                      setMaxOutputTokens(
                        Math.min(
                          8192,
                          Math.max(64, Number(event.target.value) || 64),
                        ),
                      )
                    }
                    disabled={streaming}
                  />
                </label>
                {mode === 'agent' ? (
                  <>
                    <label className="ds-field">
                      <span>Max steps</span>
                      <input
                        type="number"
                        min={1}
                        max={agentRunLimits.maxSteps}
                        value={maxSteps}
                        onChange={(event) =>
                          setMaxSteps(
                            Math.min(
                              agentRunLimits.maxSteps,
                              Math.max(1, Number(event.target.value) || 1),
                            ),
                          )
                        }
                        disabled={streaming}
                      />
                    </label>
                    <fieldset className="playground-tools" disabled={streaming}>
                      <legend>Tools</legend>
                      {agentToolNames.map((name) => (
                        <label key={name}>
                          <input
                            type="checkbox"
                            checked={tools.includes(name)}
                            onChange={() => toggleTool(name)}
                          />
                          <span>{toolLabels[name]}</span>
                          <code>{name}</code>
                        </label>
                      ))}
                    </fieldset>
                  </>
                ) : null}
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
            <PanelHeader
              title={run.kind === 'agent' ? 'Last run' : 'Last execution'}
            />
            <PanelBody>
              <dl className="playground-facts">
                {run.kind === 'agent' ? (
                  <>
                    <dt>Run</dt>
                    <dd>{run.id ?? '—'}</dd>
                    <dt>Steps</dt>
                    <dd>{run.steps ?? '—'}</dd>
                  </>
                ) : (
                  <>
                    <dt>Execution</dt>
                    <dd>{run.id ?? '—'}</dd>
                    <dt>Provider</dt>
                    <dd>{run.provider ?? '—'}</dd>
                    <dt>Model</dt>
                    <dd>{run.model ?? '—'}</dd>
                  </>
                )}
                <dt>Input tokens</dt>
                <dd>{tokens(run.inputTokens, run.id)}</dd>
                <dt>Output tokens</dt>
                <dd>{tokens(run.outputTokens, run.id)}</dd>
                <dt>{run.kind === 'agent' ? 'Outcome' : 'Finish'}</dt>
                <dd>{run.outcome ?? '—'}</dd>
              </dl>
            </PanelBody>
          </Panel>
        </div>
      </div>
    </>
  );
}

function AgentSteps({ steps, live }: { steps: AgentStep[]; live: boolean }) {
  if (!steps.length) {
    return null;
  }
  return (
    <ol className="playground-steps" aria-label="Agent steps">
      {steps.map((step) => {
        const pending = live && step.tool !== null && step.toolStatus === null;
        return (
          <li key={step.step} className="playground-step">
            <span className="playground-step-label">Step {step.step}</span>
            {step.thought ? (
              <p className="playground-thought">{step.thought}</p>
            ) : null}
            {step.tool ? (
              <div className="playground-tool">
                <div className="playground-tool-call">
                  <code>
                    {step.tool}({JSON.stringify(step.arguments ?? {})})
                  </code>
                  <Badge
                    tone={
                      step.toolStatus === 'SUCCEEDED'
                        ? 'success'
                        : step.toolStatus === 'FAILED'
                          ? 'danger'
                          : 'info'
                    }
                  >
                    {step.toolStatus?.toLowerCase() ??
                      (pending ? 'running' : 'pending')}
                  </Badge>
                </div>
                {step.toolOutput ? <pre>{step.toolOutput}</pre> : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function tokens(value: number | null, id: string | null) {
  if (value !== null) {
    return value.toLocaleString();
  }
  // Unknown usage is shown as unknown, never as zero.
  return id ? 'unknown' : '—';
}

function PlaygroundError({
  error,
  profile,
}: {
  error: Error;
  profile: string;
}) {
  const code =
    error instanceof ApiClientError || error instanceof RunStopError
      ? error.code
      : null;
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
