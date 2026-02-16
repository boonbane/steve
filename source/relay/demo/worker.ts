interface Env {
  RELAY_URL?: string;
  CLERK_PUBLISHABLE_KEY?: string;
}

const indexHtml = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Relay Clerk Demo</title>
    <style>
      body {
        font-family: system-ui, sans-serif;
        max-width: 680px;
        margin: 2rem auto;
        padding: 0 1rem;
      }
      h2 {
        margin-bottom: 0.25rem;
      }
      p {
        color: #555;
        margin-top: 0;
      }
      #auth,
      #actions {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin: 1rem 0;
        flex-wrap: wrap;
      }
      #status {
        color: #666;
      }
      #output,
      #daemon-token {
        border: 1px solid #ddd;
        border-radius: 8px;
        padding: 1rem;
        min-height: 4rem;
        white-space: pre-wrap;
        background: #fafafa;
      }
      #daemon-token {
        margin-top: 1rem;
      }
      button {
        padding: 0.5rem 0.85rem;
        cursor: pointer;
      }
    </style>
  </head>
  <body>
    <h2>Relay Clerk Demo</h2>
    <p>Sign in with Clerk, then start your daemon with <code>STEVE_DAEMON_TOKEN</code>.</p>
    <div id="auth"></div>
    <div id="status">Loading Clerk...</div>
    <div id="actions" hidden>
      <button id="hello">GET /hello</button>
      <button id="echo">POST /echo</button>
      <button id="signout">Sign out</button>
    </div>
    <div id="output">Waiting for request...</div>
    <div id="daemon-token">Daemon token not issued yet.</div>
    <script src="/config.js"></script>
    <script type="module" src="/app.js"></script>
  </body>
</html>`;

const appJs = `import { Clerk } from "https://esm.sh/@clerk/clerk-js@5";

const config = globalThis.__RELAY_DEMO_CONFIG || {};

const storedRelayUrl = localStorage.getItem("relay_url");
const relayUrl = storedRelayUrl && storedRelayUrl !== "null"
  ? storedRelayUrl
  : (config.relayUrl || prompt("Relay URL (https://...)") || "");

const storedPk = localStorage.getItem("clerk_pk");
const publishableKey = storedPk && storedPk !== "null"
  ? storedPk
  : (config.publishableKey || prompt("Clerk publishable key (pk_...)"));

if (!publishableKey) {
  document.getElementById("status").textContent = "Missing publishable key.";
  throw new Error("Missing publishable key");
}

if (!relayUrl) {
  document.getElementById("status").textContent = "Missing relay URL.";
  throw new Error("Missing relay URL");
}

localStorage.setItem("relay_url", relayUrl);
localStorage.setItem("clerk_pk", publishableKey);

const status = document.getElementById("status");
const authDiv = document.getElementById("auth");
const actions = document.getElementById("actions");
const output = document.getElementById("output");
const daemonTokenDiv = document.getElementById("daemon-token");

const DAEMON_TOKEN_KEY = "steve_daemon_token";
const DAEMON_USER_KEY = "steve_daemon_user";
const DAEMON_EXP_KEY = "steve_daemon_exp";

const clerk = new Clerk(publishableKey);
await clerk.load();

function renderDaemonToken() {
  const token = localStorage.getItem(DAEMON_TOKEN_KEY);
  const userId = localStorage.getItem(DAEMON_USER_KEY);
  const expiresAt = localStorage.getItem(DAEMON_EXP_KEY);

  if (!token) {
    daemonTokenDiv.textContent = "Daemon token not issued yet.";
    return;
  }

  daemonTokenDiv.textContent = JSON.stringify(
    {
      userId,
      expiresAt,
      daemonToken: token,
    },
    null,
    2,
  );
}

async function registerDaemonToken() {
  if (!clerk.session || !clerk.user) {
    return;
  }

  const sessionToken = await clerk.session.getToken();
  if (!sessionToken) {
    daemonTokenDiv.textContent = "Could not get session token.";
    return;
  }

  const response = await fetch(relayUrl + "/daemon/register", {
    method: "POST",
    headers: {
      authorization: "Bearer " + sessionToken,
    },
  });

  const body = await response.json();

  if (!response.ok) {
    daemonTokenDiv.textContent = JSON.stringify(body, null, 2);
    return;
  }

  localStorage.setItem(DAEMON_TOKEN_KEY, body.daemonToken);
  localStorage.setItem(DAEMON_USER_KEY, body.userId);
  localStorage.setItem(DAEMON_EXP_KEY, String(body.expiresAt || ""));
  renderDaemonToken();
}

async function render() {
  authDiv.innerHTML = "";

  if (!clerk.user || !clerk.session) {
    actions.hidden = true;
    status.textContent = "Signed out";
    clerk.mountSignIn(authDiv);
    return;
  }

  actions.hidden = false;
  status.textContent = "Signed in as " + clerk.user.id;
  clerk.mountUserButton(authDiv);
  await registerDaemonToken();
}

async function callRelay(path, init) {
  if (!clerk.session) {
    output.textContent = "Not signed in";
    return;
  }

  const token = await clerk.session.getToken();
  if (!token) {
    output.textContent = "No session token available";
    return;
  }

  const options = init || {};
  const headers = Object.assign({}, options.headers || {}, {
    authorization: "Bearer " + token,
  });

  const res = await fetch(relayUrl + path, Object.assign({}, options, { headers }));

  output.textContent = JSON.stringify(
    {
      url: relayUrl + path,
      status: res.status,
      body: await res.text(),
    },
    null,
    2,
  );
}

document.getElementById("hello").addEventListener("click", function () {
  callRelay("/hello");
});

document.getElementById("echo").addEventListener("click", function () {
  callRelay("/echo", {
    method: "POST",
    body: "Echo time...",
  });
});

document.getElementById("signout").addEventListener("click", async function () {
  await clerk.signOut();
  localStorage.removeItem(DAEMON_TOKEN_KEY);
  localStorage.removeItem(DAEMON_USER_KEY);
  localStorage.removeItem(DAEMON_EXP_KEY);
  renderDaemonToken();
  await render();
});

clerk.addListener(async function (event) {
  if (!event.user) {
    await render();
  }
});

renderDaemonToken();
await render();
`;

const jsonString = (value: unknown) =>
  JSON.stringify(value).replace(/</g, "\\u003c");

export default {
  fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    if (url.pathname === "/app.js") {
      return new Response(appJs, {
        headers: { "content-type": "application/javascript; charset=utf-8" },
      });
    }

    if (url.pathname === "/config.js") {
      const payload = {
        relayUrl: env.RELAY_URL,
        publishableKey: env.CLERK_PUBLISHABLE_KEY,
      };

      return new Response(
        `globalThis.__RELAY_DEMO_CONFIG = ${jsonString(payload)};`,
        {
          headers: { "content-type": "application/javascript; charset=utf-8" },
        },
      );
    }

    if (url.pathname !== "/") {
      return new Response("Not found", { status: 404 });
    }

    return new Response(indexHtml, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
};
