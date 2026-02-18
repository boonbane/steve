// @ts-check
import { defineConfig } from "astro/config";
import config from "./config.mjs";

import starlight from "@astrojs/starlight";
import starlightThemeBlack from "starlight-theme-black";

import solidJs from "@astrojs/solid-js";

// https://astro.build/config
export default defineConfig({
  integrations: [
    starlight({
      title: "Steve",
      lastUpdated: true,
      expressiveCode: { themes: ["dark-plus"] },
      social: [{ icon: "github", label: "GitHub", href: config.github }],
      editLink: {
        baseUrl: `${config.github}/edit/main/packages/web/`,
      },
      sidebar: [
        {
          label: "Start",
          items: ["getting-started", "install"],
        },
      ],
      plugins: [
        starlightThemeBlack({
          navLinks: [
            { label: "Docs", link: "/getting-started" },
            { label: "Account", link: "/account" },
            { label: "Log In", link: "/login" },
          ],
        }),
      ],
    }),
    solidJs(),
  ],
});
