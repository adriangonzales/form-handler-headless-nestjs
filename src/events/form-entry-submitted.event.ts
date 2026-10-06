import type { FormEntry } from '../form-entries/form-entry.entity';

/**
 * `FormEntrySubmitted`: the entry came from a public submission, so it is
 * checked for spam, alerted and has its user agent parsed (ch. 6 §6.1).
 */
export class FormEntrySubmitted {
  static readonly event = 'form-entry.submitted';

  constructor(readonly formEntry: FormEntry) {}
}
