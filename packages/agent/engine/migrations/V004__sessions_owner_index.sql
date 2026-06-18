-- ADR-0029: owner-aware session listing within tenant.
ALTER TABLE sessions
  ADD KEY idx_tenant_user_active (tenant, user_id, last_active_time, deleted);
