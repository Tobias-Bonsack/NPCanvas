/**
 * Compile-time exhaustiveness check for discriminated unions. A missed variant makes the
 * call site a type error. Not `const _never: never = x` — `noUnusedLocals` rejects that.
 */
export function assertNever(value: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(value)}`)
}
