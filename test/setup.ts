// Tests inject a dedicated secret. Production code never uses this value.
process.env.RIVET_DEMO_SESSION_SECRET ??=
  "test-only-rivet-session-secret-0123456789";
