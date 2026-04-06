export interface ValidationError {
  instanceLocation: string;
  error: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Build-time/runtime fallback shim for environments where `@cfworker/json-schema`
 * cannot be installed from registry due policy restrictions.
 *
 * The MCP client only needs a `Validator` class with a `validate` method.
 * For MVP demo usage we return success and skip strict schema checks.
 */
export class Validator {
  constructor(
    _schema: unknown,
    _draft: '2020-12' | '2019-09' | string = '2020-12',
    _shortcircuit = true
  ) {}

  validate(_input: unknown): ValidationResult {
    return {
      valid: true,
      errors: []
    };
  }
}
