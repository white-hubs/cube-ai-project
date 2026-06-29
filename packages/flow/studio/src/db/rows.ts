// Plain row interfaces for the flow_studio_* tables (replicated ai-application flow-editor tables).
// Mirrors flow-core's row-interface persistence style (see flow/core/src/db/mysql-repositories.ts).
// `tenant` INT -> `tenant_id` VARCHAR(64) (identity seam: tenantContextAls.tenantId is a string).

export interface StudioAuditColumns {
  create_by: string;
  creator_id: string | null;
  creator_type: string | null;
  update_by: string;
  updater_id: string | null;
  updater_type: string | null;
}

export interface FlowStudioFlowRow extends StudioAuditColumns {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  editor_flow_json: string;
  compiled_flow_json: string | null;
  component_snapshot_json: string | null;
  compile_status: string;
  compile_error: string | null;
  compile_revision: string;
  remote_flow_id: string | null;
  remote_binding_status: string | null;
  published_release_id: string | null;
  published_revision: string | null;
  last_compiled_time: string | null;
  last_synced_time: string | null;
  enabled: boolean | null;
  remark: string | null;
  create_time: string;
  update_time: string;
  deleted: string | null;
}

export interface FlowStudioResourceRefRow extends StudioAuditColumns {
  id: string;
  tenant_id: string;
  flow_id: string;
  node_id: string;
  component_key: string;
  resource_type: string;
  resource_id: string;
  resource_sub_id: string | null;
  resource_name_snapshot: string | null;
  resource_status_snapshot: string | null;
  required: boolean;
  invalid: boolean;
  invalid_reason: string | null;
  remark: string | null;
  create_time: string;
  update_time: string;
  deleted: string | null;
}

export interface FlowStudioComponentRow extends StudioAuditColumns {
  id: string;
  tenant_id: string;
  component_key: string;
  component_name: string;
  component_group: string | null;
  component_type: string;
  component_version: string;
  mapping_type: string;
  mapping_target: string | null;
  mapping_template_json: string | null;
  protocol_schema_json: string | null;
  presentation_schema_json: string | null;
  execution_policy_json: string | null;
  icon_url: string | null;
  sort_order: string;
  enabled: boolean;
  is_builtin: boolean;
  remote_component_id: string | null;
  remark: string | null;
  create_time: string;
  update_time: string;
  deleted: string | null;
}

export interface FlowStudioReleaseRow extends StudioAuditColumns {
  id: string;
  tenant_id: string;
  flow_id: string;
  release_version: string;
  name: string;
  description: string | null;
  editor_flow_json: string;
  compiled_flow_json: string;
  component_snapshot_json: string | null;
  release_note: string | null;
  status: string;
  published_time: string;
  remark: string | null;
  create_time: string;
  update_time: string;
  deleted: string | null;
}
