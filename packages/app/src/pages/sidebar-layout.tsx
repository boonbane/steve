import { A } from "@solidjs/router";
import { For, Show, type JSX, type ParentProps } from "solid-js";
import "./sidebar-layout.css";

type SidebarLink = {
  href: string;
  label: string;
  end?: boolean;
};

type SidebarLayoutProps = ParentProps<{
  links: readonly SidebarLink[];
  footerLinks?: readonly SidebarLink[];
  footerActions?: readonly JSX.Element[];
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
          <div data-slot="section-nav-group">
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
          </div>
          <For each={props.footerLinks ?? []}>
            {(item, index) => (
              <div
                data-slot="section-nav-group"
                data-position={index() === 0 ? "footer" : undefined}
              >
                <A
                  href={item.href}
                  end={item.end}
                  activeClass="active"
                  data-nav-button
                >
                  {item.label}
                </A>
              </div>
            )}
          </For>
          <Show when={(props.footerActions?.length ?? 0) > 0}>
            <div data-slot="section-nav-group" data-position="footer">
              <For each={props.footerActions ?? []}>{(item) => item}</For>
            </div>
          </Show>
        </nav>
      </aside>
      <section data-layout-pane="content">
        <div data-component="section-content">{props.children}</div>
      </section>
    </section>
  );
}
