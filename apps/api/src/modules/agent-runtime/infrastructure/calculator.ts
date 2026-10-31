// Safe arithmetic for the `calculate` tool. A small recursive-descent parser:
// no eval, no identifiers beyond a fixed allow-list, bounded input.

// Maps, not object literals, so names like "constructor" never resolve.
const functions: ReadonlyMap<string, (value: number) => number> = new Map([
  ['sqrt', Math.sqrt],
  ['abs', Math.abs],
  ['round', Math.round],
  ['floor', Math.floor],
  ['ceil', Math.ceil],
  ['ln', Math.log],
  ['log10', Math.log10],
]);
const constants: ReadonlyMap<string, number> = new Map([
  ['pi', Math.PI],
  ['e', Math.E],
]);

export class CalculationError extends Error {}

export function calculate(expression: string): number {
  if (expression.length > 200) {
    throw new CalculationError('Expression is longer than 200 characters.');
  }
  const parser = new Parser(expression.replace(/\s+/g, '').toLowerCase());
  const value = parser.parse();
  if (!Number.isFinite(value)) {
    throw new CalculationError('The result is not a finite number.');
  }
  return value;
}

class Parser {
  private index = 0;
  private depth = 0;

  constructor(private readonly text: string) {}

  parse(): number {
    if (!this.text) {
      throw new CalculationError('Expression is empty.');
    }
    const value = this.expression();
    if (this.index !== this.text.length) {
      throw new CalculationError(
        `Unexpected "${this.text[this.index]}" at position ${this.index + 1}.`,
      );
    }
    return value;
  }

  private expression(): number {
    let value = this.term();
    for (;;) {
      if (this.take('+')) {
        value += this.term();
      } else if (this.take('-')) {
        value -= this.term();
      } else {
        return value;
      }
    }
  }

  private term(): number {
    let value = this.unary();
    for (;;) {
      if (this.take('*')) {
        value *= this.unary();
      } else if (this.take('/')) {
        const divisor = this.unary();
        if (divisor === 0) {
          throw new CalculationError('Division by zero.');
        }
        value /= divisor;
      } else if (this.take('%')) {
        value %= this.unary();
      } else {
        return value;
      }
    }
  }

  // Unary minus binds looser than ^, so -2^2 = -4.
  private unary(): number {
    if (this.take('-')) {
      return -this.unary();
    }
    if (this.take('+')) {
      return this.unary();
    }
    return this.power();
  }

  private power(): number {
    const base = this.primary();
    // Right-associative, and the exponent may be signed: 2^3^2 = 2^9, 2^-1 = 0.5.
    return this.take('^') ? base ** this.unary() : base;
  }

  private primary(): number {
    if (++this.depth > 50) {
      throw new CalculationError('Expression is nested too deeply.');
    }
    try {
      if (this.take('(')) {
        const value = this.expression();
        this.expect(')');
        return value;
      }
      const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/.exec(
        this.text.slice(this.index),
      );
      if (number) {
        this.index += number[0].length;
        return Number(number[0]);
      }
      const name = /^[a-z][a-z0-9]*/.exec(this.text.slice(this.index));
      if (name) {
        this.index += name[0].length;
        const fn = functions.get(name[0]);
        if (fn) {
          this.expect('(');
          const value = fn(this.expression());
          this.expect(')');
          return value;
        }
        const constant = constants.get(name[0]);
        if (constant !== undefined) {
          return constant;
        }
        throw new CalculationError(`Unknown name "${name[0]}".`);
      }
      throw new CalculationError(
        this.index < this.text.length
          ? `Unexpected "${this.text[this.index]}" at position ${this.index + 1}.`
          : 'Expression ended unexpectedly.',
      );
    } finally {
      this.depth -= 1;
    }
  }

  private take(symbol: string): boolean {
    if (this.text[this.index] === symbol) {
      this.index += 1;
      return true;
    }
    return false;
  }

  private expect(symbol: string) {
    if (!this.take(symbol)) {
      throw new CalculationError(`Expected "${symbol}".`);
    }
  }
}
