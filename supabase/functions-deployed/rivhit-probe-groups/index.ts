// Retired diagnostic function (Wave 8 security cleanup). Kept as a stub
// because the platform has no delete; verify_jwt is ON so anonymous calls
// are rejected at the gateway anyway.
Deno.serve(() => new Response('gone', { status: 410 }))
