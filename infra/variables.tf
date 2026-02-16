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

variable "DEMO_CLERK_PUBLISHABLE_KEY" {
  type        = string
  description = "Clerk publishable key used by the demo worker."
  sensitive   = true
}
