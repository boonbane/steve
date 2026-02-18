import { SidebarLayout } from "./sidebar-layout";
import { SETTINGS_NAV } from "./settings-nav";

export default function Account() {
  return (
    <SidebarLayout links={SETTINGS_NAV} navLabel="Settings pages">
      <section data-page="settings-section">
        <header data-slot="section-title">
          <h1>Account</h1>
          <p>Manage your profile and default workspace preferences.</p>
        </header>
        <section data-slot="section-list">
          <article data-slot="card">
            <h2>Profile</h2>
            <p>Update your display name, email, and avatar.</p>
          </article>
          <article data-slot="card">
            <h2>Defaults</h2>
            <p>Choose startup behavior, theme, and notification defaults.</p>
          </article>
          <article data-slot="card">
            <h2>Security</h2>
            <p>Review active sessions and rotate personal credentials.</p>
          </article>
        </section>
      </section>
    </SidebarLayout>
  );
}
