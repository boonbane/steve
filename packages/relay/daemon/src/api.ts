export const AUTH_URL = process.env.AUTH_URL!
export const RELAY_URL = process.env.RELAY_URL!
export const STEVE_URL = process.env.STEVE_URL!

export const api = {
  tunnel: () => `${RELAY_URL}/tunnel`,
  token: () => `${AUTH_URL}/token`,
  server: (url: string) => `${STEVE_URL}/${url}`,
  relay: (url: string) => `${RELAY_URL}/${url}`,
}
