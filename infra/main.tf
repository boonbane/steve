terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.16.0"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.5.0"
    }
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

resource "cloudflare_workers_kv_namespace" "auth" {
  account_id = var.cloudflare_account_id
  title      = "steve-auth-${var.environment}"
}

resource "cloudflare_d1_database" "main" {
  account_id = var.cloudflare_account_id
  name       = "steve-${var.environment}"

  read_replication = {
    mode = "disabled"
  }
}

resource "local_file" "relay_server_wrangler_generated" {
  filename = "${path.module}/../source/relay/server/wrangler.jsonc"
  content = templatefile("${path.module}/templates/relay-server.wrangler.jsonc.tftpl", {
    RELAY_CORS_ORIGIN = var.RELAY_CORS_ORIGIN
    RELAY_AUTH_ISSUER = var.RELAY_AUTH_ISSUER
  })
}

resource "local_file" "relay_demo_wrangler_generated" {
  filename = "${path.module}/../source/relay/demo/wrangler.jsonc"
  content = templatefile("${path.module}/templates/relay-demo.wrangler.jsonc.tftpl", {
    RELAY_URL                  = var.RELAY_URL
    DEMO_CLERK_PUBLISHABLE_KEY = var.DEMO_CLERK_PUBLISHABLE_KEY
  })
}
