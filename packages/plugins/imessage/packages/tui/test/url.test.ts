import { expect, test } from "bun:test";
import { baseUrlFrom, DEFAULT_BASE_URL, DEFAULT_PORT } from "../src/api.ts";

test("bare hostname + port", () => {
  expect(baseUrlFrom("miles", 69)).toBe("http://miles:69");
});

test("bare hostname defaults to the API port", () => {
  expect(baseUrlFrom("miles")).toBe(`http://miles:${DEFAULT_PORT}`);
});

test("full URL keeps its implicit port (tailscale serve on 443)", () => {
  expect(baseUrlFrom("https://miles.tail1234.ts.net")).toBe(
    "https://miles.tail1234.ts.net",
  );
});

test("full URL + separate port field", () => {
  expect(baseUrlFrom("https://miles.tail1234.ts.net", 8443)).toBe(
    "https://miles.tail1234.ts.net:8443",
  );
});

test("explicit port in url wins over port field", () => {
  expect(baseUrlFrom("miles:9999", 69)).toBe("http://miles:9999");
});

test("port only targets localhost", () => {
  expect(baseUrlFrom(undefined, 69)).toBe("http://127.0.0.1:69");
});

test("nothing configured falls back to the default", () => {
  expect(baseUrlFrom()).toBe(DEFAULT_BASE_URL);
});
