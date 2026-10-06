import type { FormEntry } from '../form-entries/form-entry.entity';

/** `FormEntryCreated`: an entry was stored, from either submission endpoint (ch. 6 §6.1). */
export class FormEntryCreated {
  static readonly event = 'form-entry.created';

  constructor(readonly formEntry: FormEntry) {}
}
