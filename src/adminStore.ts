import { lazy } from './lazy';
import { Restrict, Store } from './store';
import type { UserStore } from './userStore';

export class AdminStore extends Store {
  @Restrict('rw')
  public user: UserStore;
  // @Restrict() --> this.defaultPolicy
  name: string = 'John Doe';

  @Restrict('rw')
  getCredentials = lazy(() => {
    const credentialStore = new Store();
    credentialStore.writeEntries({ username: 'user1' });
    return credentialStore;
  });

  constructor(user: UserStore) {
    super();
    this.defaultPolicy = 'none';
    this.user = user;
  }
}
