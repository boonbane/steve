import { fileURLToPath } from "url";
import devtools from "solid-devtools/vite";
import solidPlugin from "vite-plugin-solid";

const appPlugin = [
  {
    name: "steve-app:config",
    config() {
      return {
        resolve: {
          alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
          },
        },
      };
    },
  },
  devtools(),
  solidPlugin(),
];

export default appPlugin;
