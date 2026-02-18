import { For } from "solid-js";
import { SidebarLayout } from "./sidebar-layout";
import { SETTINGS_NAV } from "./settings-nav";

export default function Devices() {
  const devices = [
    {
      device: "MacBook Pro",
      ip: "203.0.113.12",
      key: "dev_8f2a3b71",
      lastSeen: "2 minutes ago",
    },
    {
      device: "iPhone 16",
      ip: "198.51.100.42",
      key: "dev_5ddc8e10",
      lastSeen: "1 hour ago",
    },
    {
      device: "Workstation",
      ip: "203.0.113.77",
      key: "dev_a49c2f33",
      lastSeen: "Today, 09:14",
    },
    {
      device: "Ubuntu VM",
      ip: "192.0.2.91",
      key: "dev_2c7b5de9",
      lastSeen: "Yesterday",
    },
  ];

  return (
    <SidebarLayout links={SETTINGS_NAV} navLabel="Settings pages">
      <section data-page="settings-section">
        <header data-slot="section-title">
          <h1>Devices</h1>
          <p>Review active sessions and remove stale device access.</p>
        </header>
        <div data-component="settings-table-wrap">
          <table data-component="settings-table">
            <thead>
              <tr>
                <th>Device</th>
                <th>IP</th>
                <th>Key</th>
                <th>Last Seen</th>
              </tr>
            </thead>
            <tbody>
              <For each={devices}>
                {(row) => (
                  <tr>
                    <td>{row.device}</td>
                    <td>{row.ip}</td>
                    <td>{row.key}</td>
                    <td>{row.lastSeen}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </section>
    </SidebarLayout>
  );
}
