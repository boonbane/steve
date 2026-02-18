variable "cloudflare_api_token" {
  type      = string
  sensitive = true
}

variable "cloudflare_account_id" {
  type = string
}

variable "environment" {
  type    = string
  default = "dev"
}

variable "WEB_DOMAIN" {
  type        = string
  description = "Primary custom domain for website Pages project."
}

variable "APP_DOMAIN" {
  type        = string
  description = "Custom domain for app Pages project."
}

variable "WEB_PAGES_PROJECT_NAME" {
  type        = string
  description = "Cloudflare Pages project name for Astro website."
}

variable "APP_PAGES_PROJECT_NAME" {
  type        = string
  description = "Cloudflare Pages project name for Solid app."
}

variable "RELAY_CORS_ORIGIN" {
  type        = string
  description = "Allowed browser origin for relay CORS/auth checks."
}

variable "RELAY_AUTH_ISSUER" {
  type        = string
  description = "Auth issuer URL for relay worker config."
}

variable "RELAY_URL" {
  type        = string
  description = "Relay URL used by demo and daemon clients."
  sensitive   = true
}

variable "CLERK_PUBLISHABLE_KEY" {
  type        = string
  description = "Clerk publishable key used by the demo worker."
  sensitive   = true
}
