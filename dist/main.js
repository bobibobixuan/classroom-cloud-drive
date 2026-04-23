import { createApp, RouterView } from './deps.js';
import { router } from './router.js';

const Root = {
  components: { RouterView },
  template: '<RouterView />',
};

const app = createApp(Root);
app.use(router);
app.mount('#app');
