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

resource "cloudflare_pages_project" "web" {
  account_id        = var.cloudflare_account_id
  name              = var.WEB_PAGES_PROJECT_NAME
  production_branch = "main"
}

resource "cloudflare_pages_project" "app" {
  account_id        = var.cloudflare_account_id
  name              = var.APP_PAGES_PROJECT_NAME
  production_branch = "main"
}

resource "cloudflare_pages_domain" "web" {
  account_id   = var.cloudflare_account_id
  project_name = cloudflare_pages_project.web.name
  name         = var.WEB_DOMAIN
}

resource "cloudflare_pages_domain" "app" {
  account_id   = var.cloudflare_account_id
  project_name = cloudflare_pages_project.app.name
  name         = var.APP_DOMAIN
}

resource "local_file" "relay_server_wrangler_generated" {
  filename = "${path.module}/../packages/relay/server/wrangler.jsonc"
  content = templatefile("${path.module}/templates/relay-server.wrangler.jsonc.tftpl", {
    RELAY_CORS_ORIGIN = var.RELAY_CORS_ORIGIN
    RELAY_AUTH_ISSUER = var.RELAY_AUTH_ISSUER
  })
}

resource "local_file" "relay_demo_wrangler_generated" {
  filename = "${path.module}/../packages/relay/demo/wrangler.jsonc"
  content = templatefile("${path.module}/templates/relay-demo.wrangler.jsonc.tftpl", {
    RELAY_URL             = var.RELAY_URL
    CLERK_PUBLISHABLE_KEY = var.CLERK_PUBLISHABLE_KEY
  })
}

resource "local_file" "app_wrangler_generated" {
  filename = "${path.module}/../packages/app/wrangler.jsonc"
  content = templatefile("${path.module}/templates/app.wrangler.jsonc.tftpl", {
    PAGES_PROJECT_NAME = cloudflare_pages_project.app.name
  })
}

resource "local_file" "web_wrangler_generated" {
  filename = "${path.module}/../packages/web/wrangler.jsonc"
  content = templatefile("${path.module}/templates/web.wrangler.jsonc.tftpl", {
    PAGES_PROJECT_NAME = cloudflare_pages_project.web.name
  })
}
