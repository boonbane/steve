async function main() {
  const base = "http://localhost:8787";

  const res = await fetch(`${base}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials&provider=dummy&client_id=test&client_secret=test",
  });

  console.log(res.status, res.statusText);
  console.log(await res.json());
}

main();
