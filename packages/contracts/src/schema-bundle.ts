import { z } from 'zod';
import {
  ExecutionProfile,
  AdapterDescriptor,
  Profile,
} from './schemas/profiles.js';
import {
  ChatRequest,
  GenerateRequest,
  ExecutionRequest,
} from './schemas/requests.js';
import {
  ExecutionStatus,
  Attempt,
  Usage,
  Snapshot,
} from './schemas/execution.js';
import { ErrorEnvelope } from './schemas/errors.js';
import { Event, CancelRequest, ToolOperation } from './schemas/events.js';
import { ValidationInput } from './validation/types.js';

const schemas = {
  ExecutionProfile,
  AdapterDescriptor,
  ChatRequest,
  GenerateRequest,
  ExecutionRequest,
  ExecutionStatus,
  Attempt,
  Usage,
  Snapshot,
  ErrorEnvelope,
  Event,
  CancelRequest,
  ToolOperation,
  M0Profile: Profile,
  ValidationInput,
};

export const schemaBundle = Object.fromEntries(
  Object.entries(schemas).map(([k, v]) => [
    k,
    z.toJSONSchema(v, { target: 'draft-2020-12', io: 'input' }),
  ]),
);
