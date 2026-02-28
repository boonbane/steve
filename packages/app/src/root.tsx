import "./index.css";

import { Router } from "@solidjs/router";
import { Font } from "@steve/ui/font";

import App from "./app";
import { PlatformProvider, type Platform } from "./platform";
import { routes } from "./routes";

type RootProps = {
  platform?: Platform;
};

export const AppRoot = (props: RootProps) => {
  return (
    <PlatformProvider value={props.platform}>
      <Font />
      <Router root={(next) => <App>{next.children}</App>}>{routes}</Router>
    </PlatformProvider>
  );
};
