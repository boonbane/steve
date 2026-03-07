import { SidebarLayout } from "./sidebar-layout";

export default function Steve() {
  return (
    <SidebarLayout
      links={[
        { href: "/steve", label: "Chat", end: true },
        { href: "/steve/settings", label: "Settings" },
      ]}
      navLabel="Steve pages"
    >
      <section data-page="settings-section">
        <header data-slot="section-title">
          <h1>Chat</h1>
          <p>Start a conversation with a connected Steve server.</p>
        </header>
      </section>
    </SidebarLayout>
  );
}
