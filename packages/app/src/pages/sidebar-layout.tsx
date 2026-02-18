import { A } from "@solidjs/router";
import { For, type ParentProps } from "solid-js";
import "./sidebar-layout.css";

type SidebarLink = {
  href: string;
  label: string;
  end?: boolean;
};

type SidebarLayoutProps = ParentProps<{
  links: readonly SidebarLink[];
  navLabel?: string;
}>;

export function SidebarLayout(props: SidebarLayoutProps) {
  return (
    <section data-layout="sidebar-split">
      <aside data-layout-pane="sidebar">
        <nav
          data-component="section-nav"
          aria-label={props.navLabel ?? "Section navigation"}
        >
          <For each={props.links}>
            {(item) => (
              <A
                href={item.href}
                end={item.end}
                activeClass="active"
                data-nav-button
              >
                {item.label}
              </A>
            )}
          </For>
        </nav>
      </aside>
      <section data-layout-pane="content">
        <div data-component="section-content">{props.children}</div>
      </section>
    </section>
  );
}
