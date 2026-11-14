import { setGlobalProxyFromEnv } from 'node:http';

// Node 24 supports the host's standard HTTP(S)_PROXY and NO_PROXY settings.
// This also configures fetch; loopback Ollama stays direct when NO_PROXY says so.
// Never disables certificate checks or invents proxy credentials.
setGlobalProxyFromEnv();
