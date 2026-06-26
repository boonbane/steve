/* @refresh reload */
import { render } from "solid-js/web";

import { Font } from "@steve/ui/font";

import App from "./app";
import "./index.css";

const root = document.getElementById("root");

render(
  () => (
    <>
      <Font />
      <App />
    </>
  ),
  root!,
);
