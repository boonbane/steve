import { SidebarLayout } from "./sidebar-layout";
import { SETTINGS_NAV } from "./settings-nav";

export default function Billing() {
  return (
    <SidebarLayout links={SETTINGS_NAV} navLabel="Settings pages">
      <section data-page="settings-section">
        <header data-slot="section-title">
          <h1>Billing</h1>
          <p>Track usage, payment methods, and invoice history.</p>
        </header>
        <section data-slot="section-list">
          <article data-slot="card">
            <h2>Current plan</h2>
            <p>Pro plan with monthly billing and team access enabled.</p>
          </article>
          <article data-slot="card">
            <h2>Payment method</h2>
            <p>Visa ending in 4242. Expires 04/2030.</p>
          </article>
          <article data-slot="card">
            <h2>Invoices</h2>
            <p>Download receipts and view all past statements.</p>
          </article>
        </section>
      </section>
    </SidebarLayout>
  );
}
