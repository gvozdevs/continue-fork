import {
  OAuthClientProvider,
  auth,
} from "@modelcontextprotocol/sdk/client/auth.js";
import {
  OAuthClientInformationFull,
  OAuthClientInformationSchema,
  OAuthTokens,
  OAuthTokensSchema,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { IDE } from "../..";

import http from "http";
import url from "url";
import { v4 as uuidv4 } from "uuid";
import { GlobalContext, GlobalContextType } from "../../util/GlobalContext";

// Use a Map to support concurrent authentications for different servers
interface MCPOauthContext {
  serverId: string;
  ide: IDE;
  state?: string;
}
const authenticatingContexts = new Map<string, MCPOauthContext>();

// Map state parameters to server URLs for OAuth callback matching
const stateToServerUrl = new Map<string, string>();

const PREFERRED_OAUTH_CALLBACK_PORT = 3000;
const MAX_OAUTH_PORT_ATTEMPTS = 20;

let serverInstance: http.Server | null = null;
let reservedCallbackPort: number | null = null;
let reservingCallbackPort: Promise<number> | null = null;

function redirectUrisMatch(registered: string, current: string): boolean {
  try {
    return new URL(registered).href === new URL(current).href;
  } catch {
    return registered === current;
  }
}

function portIsAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = http.createServer();
    const finish = (available: boolean) => {
      probe.removeAllListeners();
      if (probe.listening) {
        probe.close(() => resolve(available));
      } else {
        resolve(available);
      }
    };
    probe.once("error", () => finish(false));
    probe.listen(port, () => finish(true));
  });
}

function clearRegisteredOauthClients(globalContext: GlobalContext) {
  const storage = globalContext.get("mcpOauthStorage");
  if (!storage) {
    return;
  }
  let changed = false;
  const next: NonNullable<typeof storage> = {};
  for (const [url, record] of Object.entries(storage)) {
    if (record?.clientInformation) {
      changed = true;
      const rest = { ...record };
      delete rest.clientInformation;
      next[url] = rest;
    } else {
      next[url] = record;
    }
  }
  if (changed) {
    globalContext.update("mcpOauthStorage", next);
  }
}

async function chooseCallbackPort(): Promise<number> {
  const globalContext = new GlobalContext();
  const saved = globalContext.get("mcpOauthCallbackPort");
  const candidates: number[] = [];
  if (
    typeof saved === "number" &&
    saved >= 1 &&
    saved <= 65535 &&
    !candidates.includes(saved)
  ) {
    candidates.push(saved);
  }
  for (let offset = 0; offset < MAX_OAUTH_PORT_ATTEMPTS; offset++) {
    const port = PREFERRED_OAUTH_CALLBACK_PORT + offset;
    if (!candidates.includes(port)) {
      candidates.push(port);
    }
  }

  for (const port of candidates) {
    if (!(await portIsAvailable(port))) {
      continue;
    }
    if (typeof saved === "number" && saved !== port) {
      // Registered redirect URIs point at the previous port.
      clearRegisteredOauthClients(globalContext);
    }
    if (saved !== port) {
      globalContext.update("mcpOauthCallbackPort", port);
    }
    return port;
  }

  throw new Error(
    `No free localhost port for the MCP OAuth callback (tried ${candidates.join(", ")})`,
  );
}

function reserveCallbackPort(): Promise<number> {
  if (reservedCallbackPort !== null) {
    return Promise.resolve(reservedCallbackPort);
  }
  if (!reservingCallbackPort) {
    reservingCallbackPort = chooseCallbackPort()
      .then((port) => {
        reservedCallbackPort = port;
        return port;
      })
      .finally(() => {
        reservingCallbackPort = null;
      });
  }
  return reservingCallbackPort;
}

async function startCallbackServer(port: number): Promise<void> {
  if (serverInstance?.listening) {
    return;
  }
  if (serverInstance) {
    serverInstance.close();
    serverInstance = null;
  }

  const server = createServerForOAuth();
  serverInstance = server;
  await new Promise<void>((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        reservedCallbackPort = null;
        clearRegisteredOauthClients(new GlobalContext());
      }
      serverInstance = null;
      reject(error);
    });
    server.listen(port, () => {
      console.debug(
        `Server started for MCP Oauth process at http://localhost:${port}/`,
      );
      resolve();
    });
  });
}

/** Drops the in-process callback server so unit tests can pick a port again. */
export async function resetMcpOauthCallbackForTests(): Promise<void> {
  reservedCallbackPort = null;
  reservingCallbackPort = null;
  const server = serverInstance;
  serverInstance = null;
  if (!server) {
    return;
  }
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

const createServerForOAuth = () =>
  http.createServer((req, res) => {
    try {
      if (!req.url) {
        throw new Error("no url found");
      }

      const parsedUrl = url.parse(req.url, true);
      if (!parsedUrl.query["code"]) {
        throw new Error("no query params found");
      }

      const code = parsedUrl.query["code"] as string;
      const state = parsedUrl.query["state"] as string | undefined;

      void handleMCPOauthCode(code, state);

      const html = `
<!DOCTYPE html>
<html>
<head><title>Authentication Complete</title></head>
<body>Authentication Complete. You can close this page now.</body>
</html>`;

      res.writeHead(200, {
        "Content-Type": "text/html",
      });
      res.end(html);
    } catch (error) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end(`Unexpected redirect error:  ${(error as Error).message}`);
    }
  });

type MCPOauthStorage = GlobalContextType["mcpOauthStorage"][string];
type MCPOauthStorageKey = keyof MCPOauthStorage;

export class MCPConnectionOauthProvider implements OAuthClientProvider {
  private globalContext: GlobalContext;
  private _redirectUrl: string;
  private _redirectUrlInitialized: Promise<void> | null = null;
  private _port = PREFERRED_OAUTH_CALLBACK_PORT;

  constructor(
    public oauthServerUrl: string,
    private ide: IDE,
    private serverId = "",
  ) {
    this.globalContext = new GlobalContext();
    this._redirectUrl = `http://localhost:${PREFERRED_OAUTH_CALLBACK_PORT}`;
  }

  private async _initializeRedirectUrl(): Promise<void> {
    this._port = await reserveCallbackPort();
    const localUri = `http://localhost:${this._port}`;
    this._redirectUrl = localUri;
    try {
      // If IDE supports getExternalUri (VS Code extension), use it for dynamic redirect URI
      if (this.ide.getExternalUri) {
        this._redirectUrl = await this.ide.getExternalUri(localUri);
      }
    } catch (error) {
      console.error("Failed to initialize redirect URL:", error);
      this._redirectUrl = localUri;
    }
    this.dropMismatchedClientRegistration();
  }

  get redirectUrl() {
    // Always return a valid URL, even if initialization is pending
    return this._redirectUrl;
  }

  async ensureRedirectUrl(): Promise<string> {
    if (!this._redirectUrlInitialized) {
      this._redirectUrlInitialized = this._initializeRedirectUrl();
    }
    await this._redirectUrlInitialized;
    return this._redirectUrl;
  }

  /**
   * OAuth `state` is a separate authorize query param so the registered
   * redirect URI stays stable across attempts.
   */
  state(): string {
    const existing = authenticatingContexts.get(this.oauthServerUrl);
    if (existing?.state) {
      return existing.state;
    }
    const state = uuidv4();
    authenticatingContexts.set(this.oauthServerUrl, {
      serverId: this.serverId,
      ide: this.ide,
      state,
    });
    stateToServerUrl.set(state, this.oauthServerUrl);
    return state;
  }

  get clientMetadata() {
    return {
      redirect_uris: [this.redirectUrl],
      token_endpoint_auth_method: "none" as const,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: "Continue Dev, Inc", // get this from package.json?
      client_uri: "https://continue.dev", // get this from package.json?
    };
  }

  private _getOauthStorage<K extends MCPOauthStorageKey>(key: K) {
    return this.globalContext.get("mcpOauthStorage")?.[this.oauthServerUrl]?.[
      key
    ];
  }

  private _updateOauthStorage<K extends MCPOauthStorageKey>(
    key: K,
    value: MCPOauthStorage[K],
  ) {
    const existingStorage = this.globalContext.get("mcpOauthStorage") ?? {};
    const existingServerStorage = existingStorage[this.oauthServerUrl] ?? {};

    this.globalContext.update("mcpOauthStorage", {
      ...existingStorage,
      [this.oauthServerUrl]: {
        ...existingServerStorage,
        [key]: value,
      },
    });
  }

  private _clearOauthStorage() {
    const existingStorage = this.globalContext.get("mcpOauthStorage") ?? {};
    delete existingStorage[this.oauthServerUrl];
    this.globalContext.update("mcpOauthStorage", existingStorage);
  }

  private dropMismatchedClientRegistration() {
    const registered =
      this._getOauthStorage("clientInformation")?.redirect_uris?.[0];
    if (!registered || redirectUrisMatch(registered, this._redirectUrl)) {
      return;
    }
    const existingStorage = this.globalContext.get("mcpOauthStorage") ?? {};
    const existingServerStorage = existingStorage[this.oauthServerUrl];
    if (!existingServerStorage) {
      return;
    }
    const nextServerStorage = { ...existingServerStorage };
    delete nextServerStorage.clientInformation;
    this.globalContext.update("mcpOauthStorage", {
      ...existingStorage,
      [this.oauthServerUrl]: nextServerStorage,
    });
  }

  saveClientInformation(clientInformation: OAuthClientInformationFull) {
    this._updateOauthStorage("clientInformation", clientInformation);
  }

  async clientInformation() {
    const existingClientInformation =
      this._getOauthStorage("clientInformation");
    if (!existingClientInformation) {
      return undefined;
    }
    return await OAuthClientInformationSchema.parseAsync(
      existingClientInformation,
    );
  }

  async tokens() {
    const existingTokens = this._getOauthStorage("tokens");
    if (!existingTokens) {
      return undefined;
    }
    return await OAuthTokensSchema.parseAsync(existingTokens);
  }

  saveTokens(tokens: OAuthTokens) {
    this._updateOauthStorage("tokens", tokens);
  }

  codeVerifier(): string | Promise<string> {
    const existingCodeVerifier = this._getOauthStorage("codeVerifier");
    if (!existingCodeVerifier) {
      return "";
    }
    return existingCodeVerifier;
  }

  saveCodeVerifier(codeVerifier: string) {
    this._updateOauthStorage("codeVerifier", codeVerifier);
  }

  clear() {
    this._clearOauthStorage();
  }

  async redirectToAuthorization(authorizationUrl: URL) {
    // Ensure redirect URL is initialized before proceeding
    await this.ensureRedirectUrl();
    // Register state before the browser opens when auth() did not call state().
    this.state();

    // Only create and start local server if using localhost redirect
    // For web-based VS Code, the redirect will be handled by VS Code's built-in mechanism
    const redirectIsLocal =
      this._redirectUrl.includes("localhost") ||
      this._redirectUrl.includes("127.0.0.1");
    if (!this.ide.getExternalUri || redirectIsLocal) {
      await startCallbackServer(this._port);
    }
    await this.ide.openUrl(authorizationUrl.toString());
  }
}

export async function getOauthToken(mcpServerUrl: string, ide: IDE) {
  const authProvider = new MCPConnectionOauthProvider(mcpServerUrl, ide);
  const tokens = await authProvider.tokens();
  return tokens?.access_token;
}

/**
 * checks if the authentication is already done for the current server
 * if not, starts the authentication process by opening a webpage url
 */
export async function performAuth(serverId: string, url: string, ide: IDE) {
  const authProvider = new MCPConnectionOauthProvider(url, ide, serverId);
  // Ensure redirect URL is ready before starting auth
  await authProvider.ensureRedirectUrl();

  // Generate a unique state parameter for this auth flow
  const state = uuidv4();

  // Store context for this specific server with state
  authenticatingContexts.set(url, {
    serverId,
    ide,
    state,
  });

  // Map state to server URL for callback matching
  stateToServerUrl.set(state, url);

  try {
    return await auth(authProvider, {
      serverUrl: url,
    });
  } catch (error) {
    // Clean up on error
    authenticatingContexts.delete(url);
    stateToServerUrl.delete(state);
    throw error;
  }
}

/**
 * handle the authentication code received from the oauth redirect
 */
async function handleMCPOauthCode(authorizationCode: string, state?: string) {
  let serverUrl: string | undefined;
  let context: MCPOauthContext | undefined;

  if (state) {
    // Use state parameter to find the correct server
    serverUrl = stateToServerUrl.get(state);
    if (serverUrl) {
      context = authenticatingContexts.get(serverUrl);
    }
  } else {
    // Fallback: if no state or single context, use the first one
    const contexts = Array.from(authenticatingContexts.entries());
    if (contexts.length === 1) {
      [serverUrl, context] = contexts[0];
    }
  }

  if (!context || !serverUrl) {
    console.error("No matching authenticating context found for state:", state);
    return;
  }

  const { ide, serverId } = context;

  try {
    if (!serverUrl) {
      throw new Error("No MCP server url found for authentication");
    }
    if (!authorizationCode) {
      throw new Error(`No MCP authorization code found for ${serverUrl}`);
    }

    const authProvider = new MCPConnectionOauthProvider(
      serverUrl,
      ide,
      serverId,
    );
    await authProvider.ensureRedirectUrl();
    const authStatus = await auth(authProvider, {
      serverUrl,
      authorizationCode,
    });

    if (authStatus === "AUTHORIZED") {
      const { MCPManagerSingleton } = await import("./MCPManagerSingleton"); // put dynamic import to avoid cyclic imports
      await MCPManagerSingleton.getInstance().refreshConnection(serverId);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("OAuth authorization failed:", errorMessage);
    if (context?.ide) {
      await context.ide.showToast("error", `OAuth failed: ${errorMessage}`);
    }
    try {
      const { MCPManagerSingleton } = await import("./MCPManagerSingleton");
      const manager = MCPManagerSingleton.getInstance();
      const connection = manager.connections.get(serverId);
      if (connection) {
        connection.status = "error";
        connection.errors.push(`OAuth failed: ${errorMessage}`);
      }
      manager.onConnectionsRefreshed?.();
    } catch (statusError) {
      console.error("Failed to record MCP OAuth error:", statusError);
    }
  } finally {
    // Always clean up the context and state mapping
    authenticatingContexts.delete(serverUrl);
    if (state) {
      stateToServerUrl.delete(state);
    }
  }
}

export function removeMCPAuth(url: string, ide: IDE) {
  const authProvider = new MCPConnectionOauthProvider(url, ide);
  authProvider.clear();
}
