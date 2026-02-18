output "auth_kv_namespace_id" {
  value = cloudflare_workers_kv_namespace.auth.id
}

output "d1_database_id" {
  value = cloudflare_d1_database.main.id
}

output "relay_cors_origin" {
  value = var.RELAY_CORS_ORIGIN
}

output "relay_auth_issuer" {
  value = var.RELAY_AUTH_ISSUER
}

output "relay_generated_wrangler_config" {
  value = local_file.relay_server_wrangler_generated.filename
}

output "relay_demo_generated_wrangler_config" {
  value = local_file.relay_demo_wrangler_generated.filename
}

output "web_pages_project_name" {
  value = cloudflare_pages_project.web.name
}

output "web_pages_subdomain" {
  value = cloudflare_pages_project.web.subdomain
}

output "web_pages_domain" {
  value = cloudflare_pages_domain.web.name
}

output "app_pages_project_name" {
  value = cloudflare_pages_project.app.name
}

output "app_pages_subdomain" {
  value = cloudflare_pages_project.app.subdomain
}

output "app_pages_domain" {
  value = cloudflare_pages_domain.app.name
}

output "web_generated_wrangler_config" {
  value = local_file.web_wrangler_generated.filename
}

output "app_generated_wrangler_config" {
  value = local_file.app_wrangler_generated.filename
}
