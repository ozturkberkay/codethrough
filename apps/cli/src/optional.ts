// Helper for objects with optional fields, where an absent field must be a missing
// key, not an explicit undefined. Returns a one-key object when the value is set,
// else an empty object, so callers can spread it instead of writing a ternary.

// Return `{ [key]: value }` when value is set, else `{}`.
const optionalField = <K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> =>
  value === undefined ? {} : ({ [key]: value } as Record<K, V>);

export { optionalField };
