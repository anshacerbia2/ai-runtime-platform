import { randomUUID } from 'node:crypto';
import { ApplicationError } from '../../../shared/domain/application-error.js';
import type {
  AllocateOperationCommand,
  AllocationRef,
  AllocationView,
  BudgetAuthority,
  ReserveRunCommand,
  RunReservationRef,
} from '../application/budget-authority.port.js';

/**
 * Preview budget authority: an in-memory run envelope for one request-scoped
 * run. It only checks that each allocation fits the envelope. It holds no
 * account units; the gateway still admits and charges every model step
 * against the profile's budget account. The durable whole-run reservation in
 * Accounting remains ADR-0034 stage A2.
 */
export class InProcessRunBudget implements BudgetAuthority {
  private readonly runs = new Map<
    string,
    { envelope: bigint; unit: string; released: boolean }
  >();
  private readonly allocations = new Map<string, AllocationView>();

  reserveRun(command: ReserveRunCommand): Promise<RunReservationRef> {
    const ref = { reservationId: randomUUID(), runId: command.runId };
    this.runs.set(ref.reservationId, {
      envelope: BigInt(command.envelope.amount),
      unit: command.envelope.unit,
      released: false,
    });
    return Promise.resolve(ref);
  }

  allocateOperation(command: AllocateOperationCommand): Promise<AllocationRef> {
    const run = this.runs.get(command.reservation.reservationId);
    if (
      !run ||
      run.released ||
      run.unit !== command.ceiling.unit ||
      BigInt(command.ceiling.amount) > run.envelope
    ) {
      return Promise.reject(
        new ApplicationError(
          'RESOURCE_EXHAUSTED',
          'The run budget cannot cover this step.',
        ),
      );
    }
    const ref: AllocationRef = {
      allocationId: randomUUID(),
      reservationId: command.reservation.reservationId,
      operationId: command.identity.operationId,
    };
    this.allocations.set(ref.allocationId, {
      ref,
      ceiling: command.ceiling,
      consumed: null,
      state: 'ACTIVE',
    });
    return Promise.resolve(ref);
  }

  readAllocation(ref: AllocationRef): Promise<AllocationView> {
    const view = this.allocations.get(ref.allocationId);
    return view
      ? Promise.resolve(view)
      : Promise.reject(
          new ApplicationError('NOT_FOUND', 'Allocation not found.'),
        );
  }

  releaseOperation(ref: AllocationRef): Promise<void> {
    const view = this.allocations.get(ref.allocationId);
    if (view) {
      view.state = 'RELEASED';
    }
    return Promise.resolve();
  }

  releaseRun(ref: RunReservationRef): Promise<void> {
    const run = this.runs.get(ref.reservationId);
    if (run) {
      run.released = true;
    }
    for (const [id, view] of this.allocations) {
      if (view.ref.reservationId === ref.reservationId) {
        this.allocations.delete(id);
      }
    }
    this.runs.delete(ref.reservationId);
    return Promise.resolve();
  }
}
