import type { Form } from '../forms/form.entity';

/** `FormCreated`: a form was created or duplicated (ch. 6 §6.1). */
export class FormCreated {
  static readonly event = 'form.created';

  constructor(readonly form: Form) {}
}
