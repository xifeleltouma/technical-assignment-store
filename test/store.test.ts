import { AdminStore } from './../src/adminStore';
import type { JSONObject } from '../src/json-types';
import { lazy } from '../src/lazy';
import { type Permission, Restrict, Store, type StoreValue } from '../src/store';
import { UserStore } from '../src/userStore';

/*

1. Basic Read/Write Operations

These tests check the fundamental operations for user and admin stores.

*/

describe('UserStore class - Basic Operations', () => {
  let userStore: UserStore;

  beforeEach(() => {
    userStore = new UserStore();
  });

  it('should allow reading allowed keys', () => {
    expect(userStore.allowedToRead('name')).toBe(true);
  });

  it('should allow writing allowed keys', () => {
    userStore.write('name', 'Jhone Known');
    expect(userStore.read('name')).toBe('Jhone Known');
  });

  it('should allow reading non existing keys', () => {
    expect(userStore.allowedToRead('nonExistingKey')).toBe(true);
  });

  it('should allow writing non existing keys', () => {
    expect(userStore.allowedToWrite('nonExistingKey')).toBe(true);
  });

  it('round-trips arrays via write/read and entries', () => {
    const arr = [1, 'x', false, null, { k: 2 }, [3]];
    userStore.write('arr', arr);
    expect(userStore.read('arr')).toEqual(arr);
    expect(userStore.entries().arr).toEqual(arr);
  });
});

/*

2. Inheritance and Permissions

These tests verify the permission controls and the inheritance properties in the admin store, including reading and writing permissions.

*/

describe('AdminStore class - Inheritance and Permissions', () => {
  let adminStore: AdminStore;

  beforeEach(() => {
    const userStore = new UserStore();
    adminStore = new AdminStore(userStore);
  });

  it('should disallow reading admin name', () => {
    expect(() => adminStore.read('name')).toThrow();
  });

  it('should not allow reading disallowed keys', () => {
    expect(adminStore.allowedToRead('nonExistingKey')).toBe(false);
  });

  it('should not allow writing disallowed keys', () => {
    expect(adminStore.allowedToWrite('name')).toBe(false);
  });

  it('should not allow writing disallowed keys', () => {
    expect(adminStore.allowedToWrite('nonExistingKey')).toBe(false);
  });
});

/*

3. Nested Store Operations

Tests for both user and admin stores, focusing on nested store operations.

*/

describe('Nested Store Operations', () => {
  let userStore: UserStore;
  let adminStore: AdminStore;

  beforeEach(() => {
    userStore = new UserStore();
    adminStore = new AdminStore(userStore);
  });

  it('should allow writing and reading nested keys in user store', () => {
    userStore.write('profile:name', 'John Smith');
    expect(userStore.read('profile:name')).toBe('John Smith');
  });

  it('should allow reading nested keys in admin store', () => {
    expect(adminStore.read('user:name')).toBe('John Doe');
  });

  it('should allow writing and reading nested keys in user from admin store', () => {
    adminStore.write('user:profile:name', 'John Smith');
    expect(adminStore.read('user:profile:name')).toBe('John Smith');
  });

  it('should disallow writing nested keys in admin store', () => {
    expect(() => adminStore.write('profile:name', 'John Smith')).toThrow();
  });

  it('should disallow reading nested keys in admin store', () => {
    expect(() => adminStore.read('profile:name')).toThrow();
  });

  it('should write multiple entries to the store', () => {
    const store = new Store();
    const entries: JSONObject = { a: 'value1', b: { c: 'value2' } };
    store.writeEntries(entries);
    expect(store.read('a')).toBe('value1');
    expect(store.read('b:c')).toBe('value2');

    // writeEntries correctly uses write to create objects as store
    const b = store.read('b') as Store;
    expect(b.read('c')).toBe('value2');
  });

  it('should be able to loop on a store', () => {
    const store = new Store();
    const entries: JSONObject = { value: 'value', store: { value: 'value' } };
    store.write('deep', entries);
    const cStore = store.read('deep:store') as Store;

    cStore.write('deep', entries);
    expect(store.read('deep:store:deep:store:value')).toBe('value');
  });

  it('write throws on type mismatch', () => {
    const s = new Store();
    s.write('a', 1);
    expect(() => s.write('a:b', 2)).toThrow(/not an object/);
  });
});

/*

4. Function Read Operations

This tests the ability of the AdminStore class to read from a function result.

*/

describe('AdminStore class - Function Read', () => {
  let adminStore: AdminStore;

  beforeEach(() => {
    const userStore = new UserStore();
    adminStore = new AdminStore(userStore);
  });

  it('should be allowed to read from a function result', () => {
    expect(adminStore.read('getCredentials:username')).toBe('user1');
  });

  it('should be allowed to write from a function result', () => {
    adminStore.write('getCredentials:username', 'user2');
    expect(adminStore.read('getCredentials:username')).toBe('user2');
  });
});

/*

5. Restricted Store Operations

These tests validate the behavior of a restricted store, ensuring that restricted keys can't be read or written.

*/

describe('Restricted Store', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store();
    store.defaultPolicy = 'none'; // Restrict all keys
  });

  it('write restricted key', () => {
    expect(() => {
      return store.write('restrictedKey', 'testValue');
    }).toThrow(Error);
  });

  it('read restricted key', () => {
    expect(() => {
      return store.read('restrictedKey');
    }).toThrow(Error);
  });

  it('write nested restricted key', () => {
    expect(() => {
      return store.write('nested:restrictedKey', 'testValue');
    }).toThrow(Error);
  });

  it('read nested restricted key', () => {
    expect(() => {
      return store.read('nested:restrictedKey');
    }).toThrow(Error);
  });
});

/*

6. Test Store Decorators

These tests ensure that decorators work as expected, especially when it comes to restricted properties.

*/

describe('Test Store - Decorators', () => {
  it('trying to set restricted property', () => {
    class TestStore extends Store {
      @Restrict('none') restrictedProp: string = 'ok';
    }
    const testStore = new TestStore();
    expect(() => {
      testStore.write('restrictedProp', 'new value');
    }).toThrow(Error);
  });

  it('entries method shows restricted properties', () => {
    class TestStore extends Store {
      @Restrict('r')
      public readableProperty = 'test';
    }
    const testStore = new TestStore();
    expect(testStore.entries()).toHaveProperty('readableProperty', 'test');
  });

  it('entries method hides restricted properties', () => {
    class TestStore extends Store {
      @Restrict('none')
      public restrictedProp = 'test';
    }
    const testStore = new TestStore();
    expect(testStore.entries()).not.toHaveProperty('restrictedProp');
  });

  it('entries() skips unreadable properties and adds nested Stores', () => {
    class TestStore extends Store {
      @Restrict('none') hidden = 'x';
      @Restrict('r') shown = 'y';
      @Restrict('r') nest = lazy(() => {
        const s = new Store();
        s.write('k', 1);
        return s;
      });
    }
    const t = new TestStore();
    expect(t.entries()).toEqual({ shown: 'y', nest: { k: 1 } });
  });
});

/*

7. Test Default Policy Behavior

These tests ensure that default policies are correctly applied to keys with no explicit permissions set.

*/

describe('Test Store - Default Policy Behavior', () => {
  it('disallows writing a key with with default read permission', () => {
    class TestStore extends Store {
      public defaultPolicy: Permission = 'r';
      public defaultRestrictedProp?: string;
    }
    const testStore = new TestStore();
    expect(() => {
      testStore.write('defaultRestrictedProp', 'testValue');
    }).toThrow(Error);
  });

  it('allows writing a key with no explicit permissions', () => {
    class TestStore extends Store {
      public defaultNonRestrictedProp?: string;
    }
    const testStore = new TestStore();
    testStore.write('defaultNonRestrictedProp', 'testValue');
    expect(testStore.read('defaultNonRestrictedProp')).toBe('testValue');
  });
});

/*

8. Test Multiple Levels of Nested Keys

These tests ensure that the system can correctly handle multi-level nested keys.

*/

describe('Test Store - Multiple Levels of Nested Keys', () => {
  it('allows writing and reading multi-level nested keys', () => {
    const store = new Store();
    store.write('level1:level2:level3', 'testValue');
    expect(store.read('level1:level2:level3')).toBe('testValue');
  });

  it('allows reading from an intermediate store', () => {
    const store = new Store();
    store.write('level1:level2:level3', 'testValue');

    const nestedStore = store.read('level1:level2');
    expect(nestedStore).toBeInstanceOf(Store);
    expect((nestedStore as Store).entries()).toEqual({ level3: 'testValue' });
  });
});

/*

9. Test Behavior when the Same Key is Used Multiple Times

These tests verify the behavior of the system when keys are overwritten or permissions are changed.

*/

describe('Test Store - Behavior when Same Key is Used Multiple Times', () => {
  it('overwrites key with new value', () => {
    const store = new Store();
    store.defaultPolicy = 'rw';
    store.write('key', 'value1');
    store.write('key', 'value2');
    expect(store.read('key')).toBe('value2');
  });

  it('updates key permissions', () => {
    class TestStore extends Store {
      @Restrict('rw')
      public prop?: string;
    }
    const testStore = new TestStore();
    testStore.write('prop', 'value1');
    expect(testStore.allowedToRead('prop')).toBe(true);
    expect(testStore.allowedToWrite('prop')).toBe(true);

    // Change permissions
    // ?? legacy ??
    Restrict('r')(testStore, 'prop');

    expect(testStore.allowedToRead('prop')).toBe(true);
    expect(testStore.allowedToWrite('prop')).toBe(false);
  });
});

/*

10. Test Permission Inheritance

These tests verify that nested keys correctly inherit permissions from their parent keys.

*/

describe('Test Store - Permission Inheritance', () => {
  it("nested key inherits parent key's permissions", () => {
    class ParentStore extends Store {
      @Restrict('r')
      public parentProp = lazy(() => new ChildStore());
    }
    class ChildStore extends ParentStore {}
    const baseChildStore = new ChildStore();
    const nestedChildStore = baseChildStore.read('parentProp:parentProp:parentProp') as Store;
    expect(nestedChildStore).toBeInstanceOf(ChildStore);
    expect(baseChildStore.allowedToWrite('parentProp')).toBe(false);
    expect(nestedChildStore.allowedToWrite('parentProp')).toBe(false);
  });

  describe('Decorator inheritance', () => {
    it('child instances inherit policies defined on parent prototype', () => {
      class Parent extends Store {
        @Restrict('r') x = 1;
      }
      class Child extends Parent {}
      const c = new Child();
      expect(c.allowedToRead('x')).toBe(true);
      expect(c.allowedToWrite('x')).toBe(false);
    });
  });
});

/*
11. Store - API Behavior
*/

describe('API Behavior', () => {
  const PROTECTED = [
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
  ] as const;

  let store: Store;

  beforeEach(() => {
    store = new Store();
  });

  it('denies read/write on protected top-level keys', () => {
    for (const k of PROTECTED) {
      expect(store.allowedToRead(k)).toBe(false);
      expect(store.allowedToWrite(k)).toBe(false);
      expect(() => store.read(k)).toThrow();
      expect(() => store.write(k, 'x')).toThrow();
    }
  });

  it('entries() never exposes protected keys', () => {
    store.write('safe', 1);
    const out = store.entries();
    for (const k of PROTECTED) {
      expect(out[k]).toBe(undefined);
    }
    expect(out).toHaveProperty('safe', 1);
  });

  it('rejects invalid paths', () => {
    expect(() => store.write('a::b', 1)).toThrow(/Invalid path/);
    expect(() => store.read('a:')).toThrow(/Invalid path/);
    expect(() => store.read(':a')).toThrow(/Invalid path/);
    expect(() => store.read('   ')).toThrow();
    expect(() => store.read(123 as unknown as string)).toThrow();
    expect(() => store.write(':a', 1)).toThrow();
  });

  it('normalizes undefined to null on write', () => {
    // @ts-expect-error: runtime normalization accepts JS undefined
    store.write('u', undefined);
    expect(store.read('u')).toBeNull();
    expect(store.entries()).toEqual({ u: null });
  });
});

/*

12. Lazy Unwrapping Behavior

These tests ensure we avoid side effects - who knows what people will store.
Only branded lazy thunks are executed. Otherwise, a function is a function.

*/

describe('Lazy Unwrapping Behavior', () => {
  it('read() unwraps only lazy thunks and leaves plain functions untouched', () => {
    const store = new Store();

    const lazyThunk = lazy(() => 42);
    store.write('lazyVal', lazyThunk);

    const plainFn = jest.fn(() => 99);
    store.write('plainFn', plainFn);

    expect(store.read('lazyVal')).toBe(42);
    expect(store.read('lazyVal')).toBe(42); // cached

    const plainRead = store.read('plainFn');
    expect(typeof plainRead).toBe('function');
    expect(plainFn).not.toHaveBeenCalled();
  });

  it('entries() materializes only lazy thunks and skips plain functions', () => {
    const store = new Store();

    store.write('a', 1);
    store.write(
      'b',
      lazy(() => 2),
    );

    const plainFn = jest.fn(() => 3);
    store.write('c', plainFn);

    const entries = store.entries();

    expect(entries.a).toBe(1);
    expect(entries.b).toBe(2);
    expect(entries.c).toBe(undefined);
    expect(plainFn).not.toHaveBeenCalled();
  });
});

/*

13. Entries JSON filter — simple

skip all non JSON values (only instances of Store are kept)

*/

describe('Entries JSON filter — simple', () => {
  class Foo {
    constructor(public value = 1) {}
  }

  it('keeps strings, skips class instances', () => {
    const store = new Store();
    store.write('str', 'ok');
    store.write('klass', new Foo() as unknown as StoreValue);

    const out = store.entries();

    expect(out).toEqual({ str: 'ok' });
    expect(out).not.toHaveProperty('klass');
  });
});

/*

14. Policy override

*/

describe('Policy override', () => {
  it('overrides prototype policy', () => {
    class TestStore extends Store {
      @Restrict('r') x = 1;
    }

    const a = new TestStore();
    expect(a.allowedToRead('x')).toBe(true);
    expect(a.allowedToWrite('x')).toBe(false);

    // override
    Restrict('w')(a, 'x');

    expect(a.allowedToRead('x')).toBe(false);
    expect(a.allowedToWrite('x')).toBe(true);

    // new Instance isn't affected by the override.
    const b = new TestStore();
    expect(b.allowedToRead('x')).toBe(true);
    expect(b.allowedToWrite('x')).toBe(false);
  });
});
