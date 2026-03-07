import { SteveSettingsSection } from "../components/steve-dialog";
import { SidebarLayout } from "./sidebar-layout";

export default function SteveSettings() {
  return (
    <SidebarLayout
      links={[
        { href: "/steve", label: "Chat", end: true },
        { href: "/steve/settings", label: "Settings" },
      ]}
      navLabel="Steve pages"
    >
      <SteveSettingsSection />
    </SidebarLayout>
  );
}
