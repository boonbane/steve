import { api } from "./api";

export const getToken = async () => {
  const response = await fetch(api.token(), {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "client_credentials",
      provider: "dummy",
      client_id: "test",
      client_secret: "test"
    })
  });
  const json = (await response.json()) as {
    access_token: string;
    refresh_token: string;
  };
  return json
}
