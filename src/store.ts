import type { JSONObject, JSONValue } from './json-types';
import { isLazy } from './lazy';

const SEPARATOR = ':';

export type Policy = 'r' | 'w' | 'rw' | 'none';
export type Permission = Policy;

export type StoreResult = Store | JSONValue | undefined;
export type StoreValue = JSONValue | Store | (() => StoreResult);

type Callable = (...args: unknown[]) => unknown;

export interface IStore {
  defaultPolicy: Policy;
  allowedToRead(key: string): boolean;
  allowedToWrite(key: string): boolean;
  read(path: string): StoreResult;
  write(path: string, value: StoreValue): StoreValue;
  writeEntries(entries: JSONObject): void;
  entries(): JSONObject;
}

const PROTECTED_KEYS = new Set<string>([
  '__proto__',
  'prototype',
  'constructor',
  'defaultPolicy',
  'read',
  'write',
  'writeEntries',
  'entries',
  'allowedToRead',
  'allowedToWrite',
]);

const assertKey = (key: string): void => {
  if (typeof key !== 'string' || key.trim() === '') {
    throw new Error('Key is required');
  }
};

const checkPath = (path: string): void => {
  if (typeof path !== 'string') throw new Error('Path must be a string');
  const trimmed = path.trim();
  if (trimmed.length === 0) throw new Error('Path is required');
  if (trimmed.startsWith(SEPARATOR) || trimmed.endsWith(SEPARATOR) || trimmed.includes('::')) {
    throw new Error(`Invalid path: "${path}"`);
  }
  const keys = trimmed.split(SEPARATOR);
  for (const key of keys) {
    assertKey(key);
    if (PROTECTED_KEYS.has(key)) {
      throw new Error(`Invalid key: ${key}`);
    }
  }
};

// CLASS_POLICIES: non-enumerable map attached to a prototype that holds class-level rules set by decorators.
// INSTANCE_POLICY: non-enumerable map attached to an instance that holds per-instance overrides.
const INSTANCE_POLICY = Symbol('store:instancePolicy');
const CLASS_POLICIES = Symbol('store:classPolicies');
type PolicyMap = Record<string, Policy>;

const ensurePolicyMap = (
  host: object,
  slot: typeof INSTANCE_POLICY | typeof CLASS_POLICIES,
): PolicyMap => {
  const record = host as Record<symbol, PolicyMap | undefined>;
  if (!record[slot]) {
    Object.defineProperty(host, slot, {
      value: Object.create(null),
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
  return (host as Record<symbol, PolicyMap>)[slot];
};

const getPolicy = (self: { defaultPolicy: Policy }, key: string): Policy => {
  const instanceMap = (self as Record<symbol, PolicyMap | undefined>)[INSTANCE_POLICY];
  const instancePolicy = instanceMap?.[key];
  if (instancePolicy) return instancePolicy;

  let pointer: object | null = Object.getPrototypeOf(self);
  while (pointer) {
    const classMap = (pointer as Record<symbol, PolicyMap | undefined>)[CLASS_POLICIES];
    const classPolicy = classMap?.[key];
    if (classPolicy) return classPolicy;
    pointer = Object.getPrototypeOf(pointer);
  }

  return self.defaultPolicy;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object') return false;
  if (Object.prototype.toString.call(value) !== '[object Object]') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const isFiniteNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

const isJSON = (value: unknown, seen = new WeakSet<object>(), depth = 0): value is JSONValue => {
  if (depth > 1000) return false;
  if (value === null) return true;
  const t = typeof value;
  if (t === 'string' || t === 'boolean') return true;
  if (t === 'number') return isFiniteNumber(value);
  if (Array.isArray(value)) return value.every((v) => isJSON(v, seen, depth + 1));
  if (isPlainObject(value)) {
    const obj = value as Record<string, unknown>;
    if (seen.has(obj)) return false;
    seen.add(obj);
    for (const v of Object.values(obj)) {
      if (!isJSON(v, seen, depth + 1)) return false;
    }
    return true;
  }
  return false;
};

const isPrototypeObject = (obj: object): boolean => {
  const anyObj = obj as { constructor?: unknown; prototype?: unknown };
  const constructorValue = anyObj.constructor as unknown;
  return (
    !!constructorValue &&
    typeof constructorValue === 'function' &&
    (constructorValue as { prototype: object }).prototype === obj
  );
};

const applyRule = (target: object | Callable, key: string | symbol, policy?: Policy) => {
  if (policy === undefined) return;
  if (typeof target === 'function') {
    const prototypeObject = (target as { prototype: object }).prototype;
    ensurePolicyMap(prototypeObject, CLASS_POLICIES)[String(key)] = policy;
    return;
  }
  const instanceObject = target as object;
  if (isPrototypeObject(instanceObject)) {
    ensurePolicyMap(instanceObject, CLASS_POLICIES)[String(key)] = policy;
  } else {
    ensurePolicyMap(instanceObject, INSTANCE_POLICY)[String(key)] = policy;
  }
};

export function Restrict(policy?: Policy) {
  return (value: unknown, context: unknown): void => {
    const isLegacy = typeof context === 'string' || typeof context === 'symbol';

    if (isLegacy) {
      // Restrict('w')(a, 'x');
      const target = value as object | Callable;
      const key = context as string | symbol;
      applyRule(target, key, policy);
      return;
    }

    // @Restrict('r')
    const ctx = context as {
      kind: 'field';
      name: string | symbol;
      static: boolean;
      addInitializer(init: (this: unknown) => void): void;
    };

    ctx.addInitializer(function (this: unknown) {
      type ConstructorLike = { prototype: object };
      const constructorFunction = (this as { constructor: ConstructorLike }).constructor;
      const host = ctx.static
        ? (constructorFunction as unknown as object)
        : constructorFunction.prototype;
      ensurePolicyMap(host, CLASS_POLICIES)[String(ctx.name)] = policy as Policy;
    });
  };
}

const allowedTo = (store: IStore, type: 'r' | 'w') => (key: string) => {
  assertKey(key);
  if (PROTECTED_KEYS.has(key)) return false;
  const policy = getPolicy(store, key);
  return policy.includes(type);
};

const unwrap = (value: unknown): unknown => (isLazy(value) ? value() : value);

export class Store implements IStore {
  defaultPolicy: Policy = 'rw';

  allowedToRead = allowedTo(this, 'r');
  allowedToWrite = allowedTo(this, 'w');

  read(path: string): StoreResult {
    checkPath(path);

    const keys = path.split(SEPARATOR);
    const head = keys[0];
    if (!this.allowedToRead(head)) throw new Error(`Read forbidden: ${head}`);

    let value: unknown = this;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];

      value = unwrap((value as Record<string, unknown>)[key]);

      const isLast = i === keys.length - 1;
      if (isLast || value == null) return value as StoreResult;

      if (value instanceof Store) {
        return value.read(keys.slice(i + 1).join(SEPARATOR));
      }
      if (typeof value !== 'object') {
        throw new Error(`Invalid path ${path}: \`${key}\` is not an object`);
      }
    }
  }

  write(path: string, value: StoreValue): StoreValue {
    checkPath(path);
    const keys = path.split(SEPARATOR);

    const head = keys[0];
    if (!this.allowedToWrite(head)) throw new Error(`Write forbidden: ${head}`);

    if (value === undefined) value = null;

    let pointer: Record<string, unknown> = this as unknown as Record<string, unknown>;

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      const current = pointer[key];

      if (current instanceof Store) {
        return current.write(keys.slice(i + 1).join(SEPARATOR), value);
      }

      if (current == null) {
        pointer[key] = new Store();
      } else if (typeof current !== 'object') {
        throw new Error(`Invalid path ${path}: "${key}" is not an object`);
      }

      pointer = pointer[key] as Record<string, unknown>;
    }

    const lastKey = keys[keys.length - 1];

    if (isPlainObject(value)) {
      const child = new Store();
      for (const [childKey, childValue] of Object.entries(value as JSONObject)) {
        child.write(childKey, childValue as StoreValue);
      }
      pointer[lastKey] = child;
    } else {
      pointer[lastKey] = value;
    }
    return value;
  }

  writeEntries(entries: JSONObject): void {
    const run = (entries: JSONObject, parts: Array<string> = []): void => {
      Object.entries(entries).forEach(([key, value]) => {
        const next = [...parts, key];

        if (isPlainObject(value)) {
          run(value as JSONObject, next);
        } else {
          this.write(next.join(SEPARATOR), value as StoreValue);
        }
      });
    };

    run(entries);
  }

  entries(): JSONObject {
    const seen = new WeakSet<Store>();
    const walk = (store: Store): JSONObject => {
      if (seen.has(store)) return Object.create(null);
      seen.add(store);

      const out: JSONObject = Object.create(null);
      for (const key of Object.keys(store)) {
        if (!store.allowedToRead(key)) continue;

        const raw = Reflect.get(store as object, key) as unknown;

        const value = isLazy(raw) ? (raw as () => StoreResult)() : raw;

        if (value instanceof Store) {
          out[key] = walk(value);
        } else if (value !== undefined && isJSON(value)) {
          out[key] = value;
        }
      }
      return out;
    };
    return walk(this);
  }
}
