import type {
  HistoryPage,
  SavedValidation,
  ValidationDraft,
  ValidationRecord,
} from '../../domain/validation-record.js';

export interface ValidationRepository {
  /** Atomic insert/replay/conflict; a duplicate must never create a second record. */
  saveIdempotent(draft: ValidationDraft): Promise<SavedValidation>;
  findOwned(
    applicationId: string,
    id: string,
  ): Promise<ValidationRecord | null>;
  listOwned(
    applicationId: string,
    limit: number,
    afterId?: string,
  ): Promise<HistoryPage>;
  countOwned(applicationId: string): Promise<number>;
}

export const VALIDATION_REPOSITORY = Symbol('ValidationRepository');
