import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await createApp(config);
app.enableShutdownHooks();
await app.listen(config.port, '0.0.0.0');
