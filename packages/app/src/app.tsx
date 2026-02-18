import { Suspense, type Component, type JSX } from "solid-js";
import { A, useLocation } from "@solidjs/router";
import { Icon } from "@steve/ui/icon"

const App: Component<{ children: JSX.Element }> = (props) => {
  const location = useLocation();
  const isActive = (path: string) =>
    location.pathname === path ? "true" : undefined;

  return (
    <div data-component="app-shell">
      <nav data-component="app-nav">
      <Icon />
        <A data-component="app-nav-link" data-active={isActive("/")} href="/">
          Home
        </A>
        <A
          data-component="app-nav-link"
          data-active={isActive("/account")}
          href="/account"
        >
          Account
        </A>
        <output data-component="path-pill">{location.pathname}</output>
      </nav>

      <main data-component="app-main">
        <Suspense>{props.children}</Suspense>
      </main>
    </div>
  );
};

export default App;
