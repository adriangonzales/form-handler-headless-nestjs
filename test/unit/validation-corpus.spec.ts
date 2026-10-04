import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toPhpShape } from '../../src/common/validation/php';
import {
  UnsupportedRuleError,
  validate,
} from '../../src/common/validation/validator';

/**
 * Table-driven parity with Laravel's Validator, using the corpus generated
 * by test/fixtures/laravel/scripts/validation-corpus.php (ch. 4 §4.3).
 */
interface Outcome {
  throws?: string;
  passes?: boolean;
  message?: string | null;
  errors?: [string, string[]][];
  validated?: string | null;
}
interface SingleCase extends Outcome {
  rules: string[];
  value?: unknown;
  absent?: true;
}
interface NamedCase extends Outcome {
  name: string;
}
interface Spec {
  cases: { name: string; rules: Record<string, string[]>; data: unknown }[];
}

const dir = join(__dirname, '../fixtures/validation');
const corpus = JSON.parse(readFileSync(join(dir, 'corpus.json'), 'utf8')) as {
  single: SingleCase[];
  cases: NamedCase[];
};
const spec = JSON.parse(readFileSync(join(dir, 'spec.json'), 'utf8')) as Spec;

async function outcome(
  rules: Record<string, string[]>,
  data: unknown,
): Promise<Outcome> {
  try {
    const result = await validate(rules, toPhpShape(data));
    return {
      passes: result.passes,
      message: result.message,
      errors: [...result.errors.entries()],
      validated: result.passes ? JSON.stringify(result.validated) : null,
    };
  } catch (error) {
    if (error instanceof UnsupportedRuleError)
      return { throws: 'BadMethodCallException' };
    throw error;
  }
}

function expected(o: Outcome): Outcome {
  return o.throws
    ? { throws: o.throws }
    : {
        passes: o.passes,
        message: o.message,
        errors: o.errors,
        validated: o.validated,
      };
}

describe('validation engine vs Laravel corpus', () => {
  describe('single rules', () => {
    it.each(
      corpus.single.map((c) => [
        `${JSON.stringify(c.rules)} ${c.absent ? '(absent)' : JSON.stringify(c.value)}`,
        c,
      ]),
    )('%s', async (_name, c) => {
      const data = c.absent ? {} : { field: c.value };
      expect(await outcome({ field: c.rules }, data)).toEqual(expected(c));
    });
  });

  describe('scenarios', () => {
    it.each(corpus.cases.map((c, i) => [c.name, c, spec.cases[i]] as const))(
      '%s',
      async (_name, c, input) => {
        expect(await outcome(input.rules, input.data)).toEqual(expected(c));
      },
    );
  });
});
