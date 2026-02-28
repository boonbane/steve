/* @refresh reload */
import * as app from "@steve/app";
import * as opener from "@tauri-apps/plugin-opener";
import * as web from "solid-js/web";

const platform: app.Platform = {
  platform: "desktop",
  openLink: (url: string) => {
    void opener.openUrl(url).catch(() => {
      window.open(url, "_blank");
    });
  },
  back: () => {
    window.history.back();
  },
  forward: () => {
    window.history.forward();
  },
  restart: () => {
    window.location.reload();
  },
};

const root = document.getElementById("root");

if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error("Root element not found.");
}

web.render(() => <app.AppRoot platform={platform} />, root as HTMLElement);
