import { Button } from "@steve/ui/button";
import { createSignal } from "solid-js";
import type { JSX } from "solid-js";

type SettingRowProps = {
  title: string;
  description: string;
  children: JSX.Element;
};

function SettingRow(props: SettingRowProps) {
  return (
    <div data-slot="setting-row">
      <div data-slot="setting-copy">
        <h3>{props.title}</h3>
        <p>{props.description}</p>
      </div>
      <div data-slot="setting-value">{props.children}</div>
    </div>
  );
}

export function SteveSettingsSection() {
  const [url, setUrl] = createSignal("http://localhost:1977");
  const [status, setStatus] = createSignal<"idle" | "loading" | "ok" | "error">(
    "idle",
  );

  const test = async () => {
    const value = url().trim().replace(/\/+$/, "");
    if (!value) {
      setStatus("error");
      return;
    }

    setStatus("loading");

    const response = await fetch(`${value}/health`, {
      signal: AbortSignal.timeout(1500),
    }).catch(() => undefined);

    if (!response?.ok) {
      setStatus("error");
      return;
    }

    const data = await response.json().catch(() => undefined);
    if (!data) {
      setStatus("error");
      return;
    }

    if (typeof data !== "object") {
      setStatus("error");
      return;
    }

    if (!("status" in data)) {
      setStatus("error");
      return;
    }

    if (data.status !== "ok") {
      setStatus("error");
      return;
    }

    setStatus("ok");
  };

  return (
    <section data-page="settings-section">
      <header data-slot="section-title">
        <h1>Settings</h1>
        <p>Connect this app directly to a running Steve server.</p>
      </header>
      <section data-component="settings-group">
        <h2>Connection</h2>
        <div data-component="settings-panel">
          <SettingRow title="Server" description="URL of a running Steve server">
            <div data-component="setting-control-group">
              <input
                type="text"
                inputMode="url"
                placeholder="http://localhost:1977"
                aria-label="Steve server URL"
                data-setting-control="text"
                value={url()}
                onInput={(event) => {
                  setUrl(event.currentTarget.value);
                  if (status() === "idle") return;
                  setStatus("idle");
                }}
              />
              <div data-component="setting-action-group">
                <Button
                  type="button"
                  size="small"
                  onClick={test}
                  data-status={status() === "idle" ? undefined : status()}
                >
                  {status() === "loading"
                    ? "Testing..."
                    : status() === "ok"
                      ? "OK"
                      : status() === "error"
                        ? "Error"
                        : "Test"}
                </Button>
              </div>
            </div>
          </SettingRow>
          <SettingRow
            title="Allow notifications"
            description="Dummy checkbox setting for notification permissions"
          >
            <input
              type="checkbox"
              aria-label="Allow notifications"
              data-setting-control="checkbox"
            />
          </SettingRow>
          <SettingRow
            title="Model"
            description="Dummy combo box setting for preferred model"
          >
            <select aria-label="Preferred model" data-setting-control="select">
              <option>GPT-5</option>
              <option>Claude Sonnet</option>
              <option>Gemini 2.5 Pro</option>
            </select>
          </SettingRow>
          <SettingRow
            title="Reconnect"
            description="Dummy button setting to test call-to-action spacing"
          >
            <Button type="button" size="small">
              Test connection
            </Button>
          </SettingRow>
        </div>
      </section>
    </section>
  );
}
