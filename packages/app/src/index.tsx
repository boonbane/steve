/* @refresh reload */
import "solid-devtools";

import { render } from "solid-js/web";

import { webPlatform } from "./platform";
import { AppRoot } from "./root";

const root = document.getElementById("root");

if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(
    "Root element not found. Did you forget to add it to your index.html? Or maybe the id attribute got misspelled?",
  );
}

render(() => <AppRoot platform={webPlatform} />, root!);
