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
    <h2>Steve Relay Demo</h2>
    <p>Sign in, then start your daemon by exporting <code>STEVE_DAEMON_TOKEN</code> to the returned token, running <code>steved</code>, and then running <code>steve serve</code></p>
    <div id="auth"></div>
    <div id="status">Loading...</div>
    <div id="actions" hidden>
      <button id="health">GET /health</button>
      <button id="echo">POST /echo</button>
      <button id="signout">Sign out</button>
    </div>
    <form id="prompt-form" hidden>
      <input id="prompt-input" type="text" placeholder="Say something to Steve" style="min-width:280px;padding:0.45rem;" />
      <button id="prompt-submit" type="submit">POST /prompt</button>
    </form>
    <div id="output">Waiting for request...</div>
    <div id="daemon-token">Daemon token not issued yet.</div>
    <script src="/config.js"></script>
    <script type="module" src="/app.js"></script>
  </body>
</html>`;

const appJs = `import { Clerk } from "https://esm.sh/@clerk/clerk-js@5";

const config = globalThis.__RELAY_DEMO_CONFIG || {};

const relayUrl = config.relayUrl || prompt("Relay URL (https://...)") || "";
const publishableKey = config.publishableKey || prompt("Clerk publishable key (pk_...)");

if (!publishableKey) {
  document.getElementById("status").textContent = "Missing publishable key.";
  throw new Error("Missing publishable key");
}

if (!relayUrl) {
  document.getElementById("status").textContent = "Missing relay URL.";
  throw new Error("Missing relay URL");
}

const status = document.getElementById("status");
const authDiv = document.getElementById("auth");
const actions = document.getElementById("actions");
const promptForm = document.getElementById("prompt-form");
const output = document.getElementById("output");
const daemonTokenDiv = document.getElementById("daemon-token");
let authMount = null;

const DAEMON_TOKEN_KEY = "steve_daemon_token";
const DAEMON_USER_KEY = "steve_daemon_user";
const DAEMON_EXP_KEY = "steve_daemon_exp";

const clerk = new Clerk(publishableKey);
await clerk.load();

function unmountAuth() {
  if (authMount === "signin") {
    clerk.unmountSignIn(authDiv);
  }
  if (authMount === "userbutton") {
    clerk.unmountUserButton(authDiv);
  }
  authMount = null;
}

function mountSignIn() {
  if (authMount === "signin") {
    return;
  }
  unmountAuth();
  clerk.mountSignIn(authDiv);
  authMount = "signin";
}

function mountUserButton() {
  if (authMount === "userbutton") {
    return;
  }
  unmountAuth();
  clerk.mountUserButton(authDiv);
  authMount = "userbutton";
}

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
  if (!clerk.user || !clerk.session) {
    actions.hidden = true;
    promptForm.hidden = true;
    status.textContent = "Signed out";
    mountSignIn();
    return;
  }

  actions.hidden = false;
  promptForm.hidden = false;
  status.textContent = "Signed in as " + clerk.user.id;
  mountUserButton();
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

document.getElementById("health").addEventListener("click", function () {
  callRelay("/health");
});

document.getElementById("echo").addEventListener("click", function () {
  callRelay("/echo", {
    method: "POST",
    body: "Echo time...",
  });
});

promptForm.addEventListener("submit", function (event) {
  event.preventDefault();
  const input = document.getElementById("prompt-input");
  const text = input.value.trim();
  if (!text) {
    output.textContent = "Prompt is empty.";
    return;
  }

  callRelay("/prompt", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ text }),
  });
});

document.getElementById("signout").addEventListener("click", async function () {
  unmountAuth();
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
