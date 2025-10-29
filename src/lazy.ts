export const LAZY = Symbol('lazy');

export type LazyFn<T> = (() => T) & { [LAZY]: true };

export const lazy = <T>(fn: () => T): LazyFn<T> => {
  let executed = false;
  let value!: T;

  const thunk: () => T = () => {
    if (!executed) {
      value = fn();
      executed = true;
    }
    return value;
  };

  Object.defineProperty(thunk, LAZY, { value: true });
  return thunk as LazyFn<T>;
};

export const isLazy = (v: unknown): v is LazyFn<unknown> =>
  typeof v === 'function' && v !== null && LAZY in (v as object);
