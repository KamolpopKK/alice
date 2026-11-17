// Ordered, append-only schema migrations. Never edit a migration that has shipped:
// add a new one at the end instead. Checksums of applied migrations are verified on startup.
export interface Migration {
  version: number
  name: string
  sql: string
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'foundation',
    sql: `
      CREATE TABLE installation (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;

      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE actors (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        kind TEXT NOT NULL CHECK (kind IN ('human', 'agent')),
        display_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deactivated_at TEXT
      ) STRICT;
      CREATE INDEX actors_workspace_kind ON actors(workspace_id, kind);

      CREATE TABLE activity_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        actor_id TEXT REFERENCES actors(id),
        verb TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        data TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX activity_resource ON activity_events(resource_type, resource_id, seq);
      CREATE INDEX activity_actor ON activity_events(actor_id, seq);
      CREATE INDEX activity_created ON activity_events(created_at);

      -- activity เป็น append-only: ห้าม UPDATE เสมอ, DELETE ได้เฉพาะตอน maintenance purge
      CREATE TRIGGER activity_events_no_update BEFORE UPDATE ON activity_events
      BEGIN
        SELECT RAISE(ABORT, 'activity events are append-only');
      END;
      CREATE TRIGGER activity_events_no_delete BEFORE DELETE ON activity_events
      WHEN (SELECT value FROM installation WHERE key = 'maintenance_purge') IS NULL
      BEGIN
        SELECT RAISE(ABORT, 'activity events are append-only');
      END;
    `,
  },
  {
    version: 2,
    name: 'identity',
    sql: `
      ALTER TABLE actors ADD COLUMN is_owner INTEGER NOT NULL DEFAULT 0 CHECK (is_owner IN (0, 1));
      CREATE UNIQUE INDEX actors_single_owner ON actors(workspace_id) WHERE is_owner = 1;

      CREATE TABLE human_credentials (
        actor_id TEXT PRIMARY KEY REFERENCES actors(id),
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        actor_id TEXT NOT NULL REFERENCES actors(id),
        csrf_token TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT
      ) STRICT;
      CREATE INDEX sessions_actor ON sessions(actor_id);

      CREATE TABLE invites (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        token_hash TEXT NOT NULL UNIQUE,
        note TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL REFERENCES actors(id),
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        used_by TEXT REFERENCES actors(id),
        revoked_at TEXT
      ) STRICT;

      CREATE TABLE agent_tokens (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL REFERENCES actors(id),
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        token_hint TEXT NOT NULL,
        created_by TEXT NOT NULL REFERENCES actors(id),
        created_at TEXT NOT NULL,
        last_used_at TEXT,
        revoked_at TEXT,
        replaced_by TEXT REFERENCES agent_tokens(id)
      ) STRICT;
      CREATE INDEX agent_tokens_actor ON agent_tokens(actor_id);
    `,
  },
  {
    version: 3,
    name: 'projects',
    sql: `
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        system_key TEXT,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        labels TEXT NOT NULL DEFAULT '[]',
        archived_at TEXT,
        created_by TEXT REFERENCES actors(id),
        updated_by TEXT REFERENCES actors(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX projects_system_key ON projects(workspace_id, system_key) WHERE system_key IS NOT NULL;
      CREATE INDEX projects_listing ON projects(workspace_id, archived_at, name COLLATE NOCASE);

      -- ป้องกันระดับฐานข้อมูล: system project ห้ามเปลี่ยนชื่อ, archive หรือลบ ไม่ว่าผ่านช่องทางใด
      CREATE TRIGGER projects_system_no_delete BEFORE DELETE ON projects
      WHEN OLD.system_key IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'system project cannot be deleted');
      END;
      CREATE TRIGGER projects_system_no_rename_or_archive BEFORE UPDATE ON projects
      WHEN OLD.system_key IS NOT NULL AND (NEW.name IS NOT OLD.name OR NEW.archived_at IS NOT NULL OR NEW.system_key IS NOT OLD.system_key)
      BEGIN
        SELECT RAISE(ABORT, 'system project cannot be renamed or archived');
      END;
    `,
  },
  {
    version: 4,
    name: 'tasks',
    sql: `
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        project_id TEXT NOT NULL REFERENCES projects(id),
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('backlog', 'ready', 'in_progress', 'blocked', 'done', 'canceled')),
        priority TEXT NOT NULL CHECK (priority IN ('none', 'low', 'medium', 'high', 'urgent')),
        priority_rank INTEGER NOT NULL,
        due_at TEXT,
        assignee_id TEXT REFERENCES actors(id),
        labels TEXT NOT NULL DEFAULT '[]',
        completed_at TEXT,
        archived_at TEXT,
        created_by TEXT NOT NULL REFERENCES actors(id),
        updated_by TEXT NOT NULL REFERENCES actors(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX tasks_ws_updated ON tasks(workspace_id, archived_at, updated_at, id);
      CREATE INDEX tasks_ws_status ON tasks(workspace_id, archived_at, status, updated_at, id);
      CREATE INDEX tasks_project ON tasks(project_id, archived_at, status);
      CREATE INDEX tasks_assignee ON tasks(assignee_id, archived_at, status);
      CREATE INDEX tasks_due ON tasks(workspace_id, due_at);
      CREATE INDEX tasks_priority ON tasks(workspace_id, priority_rank, id);
      CREATE INDEX tasks_created ON tasks(workspace_id, created_at, id);

      -- label แยกตารางเพื่อให้ filter ด้วย index ได้ (key เป็นตัวพิมพ์เล็ก)
      CREATE TABLE task_labels (
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        label_key TEXT NOT NULL,
        PRIMARY KEY (task_id, label_key)
      ) STRICT, WITHOUT ROWID;
      CREATE INDEX task_labels_key ON task_labels(label_key, task_id);
    `,
  },
  {
    version: 5,
    name: 'search',
    sql: `
      -- search_docs ให้ rowid คงที่ต่อ resource เพื่อ update/delete แถว FTS ได้ตรงตัว
      CREATE TABLE search_docs (
        rowid INTEGER PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('task', 'document', 'comment')),
        resource_id TEXT NOT NULL,
        task_id TEXT,
        display_title TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0,
        UNIQUE (kind, resource_id)
      ) STRICT;
      CREATE INDEX search_docs_task ON search_docs(task_id);
      CREATE INDEX search_docs_kind ON search_docs(kind, archived);

      -- trigram tokenizer: ค้นหา substring ได้ทุกภาษา รวมถึงภาษาไทยที่ไม่เว้นวรรคระหว่างคำ
      CREATE VIRTUAL TABLE search_index USING fts5(title, body, tokenize = 'trigram remove_diacritics 1');

      -- backfill งานที่มีอยู่ก่อน migration นี้
      INSERT INTO search_docs (kind, resource_id, task_id, display_title, archived)
        SELECT 'task', id, id, title, archived_at IS NOT NULL FROM tasks;
      INSERT INTO search_index (rowid, title, body)
        SELECT d.rowid, t.title, t.description FROM search_docs d JOIN tasks t ON t.id = d.resource_id WHERE d.kind = 'task';
    `,
  },
  {
    version: 6,
    name: 'documents',
    sql: `
      CREATE TABLE documents (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        source_url TEXT,
        revision INTEGER NOT NULL,
        archived_at TEXT,
        created_by TEXT NOT NULL REFERENCES actors(id),
        updated_by TEXT NOT NULL REFERENCES actors(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (length(trim(body)) > 0 OR source_url IS NOT NULL)
      ) STRICT;
      CREATE INDEX documents_listing ON documents(workspace_id, archived_at, updated_at, id);

      -- revision เก็บ snapshot เต็ม และแก้ไม่ได้ (ลบได้เฉพาะตอน maintenance purge)
      CREATE TABLE document_revisions (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id),
        number INTEGER NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        source_url TEXT,
        restored_from INTEGER,
        created_by TEXT NOT NULL REFERENCES actors(id),
        created_at TEXT NOT NULL,
        UNIQUE (document_id, number)
      ) STRICT;
      CREATE TRIGGER document_revisions_no_update BEFORE UPDATE ON document_revisions
      BEGIN
        SELECT RAISE(ABORT, 'document revisions are immutable');
      END;
      CREATE TRIGGER document_revisions_no_delete BEFORE DELETE ON document_revisions
      WHEN (SELECT value FROM installation WHERE key = 'maintenance_purge') IS NULL
      BEGIN
        SELECT RAISE(ABORT, 'document revisions are immutable');
      END;

      CREATE TABLE task_documents (
        task_id TEXT NOT NULL REFERENCES tasks(id),
        document_id TEXT NOT NULL REFERENCES documents(id),
        created_by TEXT NOT NULL REFERENCES actors(id),
        created_at TEXT NOT NULL,
        PRIMARY KEY (task_id, document_id)
      ) STRICT, WITHOUT ROWID;
      CREATE INDEX task_documents_doc ON task_documents(document_id);

      CREATE TABLE project_documents (
        project_id TEXT NOT NULL REFERENCES projects(id),
        document_id TEXT NOT NULL REFERENCES documents(id),
        created_by TEXT NOT NULL REFERENCES actors(id),
        created_at TEXT NOT NULL,
        PRIMARY KEY (project_id, document_id)
      ) STRICT, WITHOUT ROWID;
      CREATE INDEX project_documents_doc ON project_documents(document_id);
    `,
  },
  {
    version: 7,
    name: 'comments',
    sql: `
      CREATE TABLE comments (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        task_id TEXT NOT NULL REFERENCES tasks(id),
        actor_id TEXT NOT NULL REFERENCES actors(id),
        kind TEXT NOT NULL CHECK (kind IN ('comment', 'completion_summary')),
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        archived_at TEXT
      ) STRICT;
      CREATE INDEX comments_task ON comments(task_id, created_at, id);

      -- comment แก้เนื้อหาไม่ได้ (archive/purge สงวนไว้สำหรับอนาคต)
      CREATE TRIGGER comments_immutable BEFORE UPDATE OF task_id, actor_id, kind, body, created_at ON comments
      BEGIN
        SELECT RAISE(ABORT, 'comments are immutable');
      END;
    `,
  },
  {
    version: 8,
    name: 'task_relationships',
    sql: `
      ALTER TABLE tasks ADD COLUMN parent_id TEXT REFERENCES tasks(id);
      CREATE INDEX tasks_parent ON tasks(parent_id);

      -- task_id ถูก block โดย blocker_id
      CREATE TABLE task_blockers (
        task_id TEXT NOT NULL REFERENCES tasks(id),
        blocker_id TEXT NOT NULL REFERENCES tasks(id),
        created_by TEXT NOT NULL REFERENCES actors(id),
        created_at TEXT NOT NULL,
        PRIMARY KEY (task_id, blocker_id),
        CHECK (task_id <> blocker_id)
      ) STRICT, WITHOUT ROWID;
      CREATE INDEX task_blockers_blocker ON task_blockers(blocker_id, task_id);
    `,
  },
  {
    version: 9,
    name: 'client_api_events_and_idempotency',
    sql: `
      -- invalidation feed ที่ resume ได้ของ Client API: หนึ่งแถวต่อ resource ที่ต้อง refetch
      -- ไม่เก็บข้อมูลจริงของ resource และถูกตัดทิ้งตาม retention window
      CREATE TABLE client_events (
        position INTEGER PRIMARY KEY AUTOINCREMENT,
        activity_id TEXT,
        kind TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        mutation TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX client_events_created ON client_events(created_at);

      -- ผลลัพธ์ของ mutation ที่ส่งมาพร้อม Idempotency-Key ผูกกับ session ของ client
      CREATE TABLE idempotency_records (
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        status INTEGER,
        response TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (scope, key)
      ) STRICT, WITHOUT ROWID;
      CREATE INDEX idempotency_created ON idempotency_records(created_at);
    `,
  },
  {
    version: 10,
    name: 'device_authorization_and_client_sessions',
    sql: `
      -- คำขอ login จาก Desktop/CLI: เก็บเฉพาะ hash ของ device secret และ user code
      CREATE TABLE device_authorizations (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        device_secret_hash TEXT NOT NULL UNIQUE,
        user_code_hash TEXT NOT NULL UNIQUE,
        client_kind TEXT NOT NULL CHECK (client_kind IN ('desktop', 'cli')),
        client_name TEXT NOT NULL,
        device_name TEXT NOT NULL,
        client_version TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'exchanged')),
        actor_id TEXT REFERENCES actors(id),
        session_id TEXT,
        poll_interval_s INTEGER NOT NULL,
        last_poll_at TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        decided_at TEXT
      ) STRICT;
      CREATE INDEX device_authorizations_expires ON device_authorizations(expires_at);

      -- session ของ client native: access สั้น + refresh ที่หมุนทุกครั้ง (เก็บแต่ hash)
      CREATE TABLE client_sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        actor_id TEXT NOT NULL REFERENCES actors(id),
        client_kind TEXT NOT NULL CHECK (client_kind IN ('desktop', 'cli')),
        client_name TEXT NOT NULL,
        device_name TEXT NOT NULL,
        client_version TEXT NOT NULL,
        access_hash TEXT UNIQUE,
        access_expires_at TEXT,
        refresh_hash TEXT NOT NULL UNIQUE,
        refresh_expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_used_at TEXT NOT NULL,
        last_refreshed_at TEXT,
        revoked_at TEXT,
        revoke_reason TEXT
      ) STRICT;
      CREATE INDEX client_sessions_actor ON client_sessions(actor_id, created_at);

      -- refresh credential ที่ถูกหมุนไปแล้ว: ถ้าถูกใช้ซ้ำ = replay → revoke ทั้ง session
      CREATE TABLE client_refresh_history (
        refresh_hash TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES client_sessions(id),
        rotated_at TEXT NOT NULL
      ) STRICT, WITHOUT ROWID;
    `,
  },
  {
    version: 11,
    name: 'personal_task_pads',
    sql: `
      -- Pad ส่วนตัวของคนหนึ่งคน: ไม่มี activity, ไม่อยู่ใน workspace search
      CREATE TABLE pads (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        owner_id TEXT NOT NULL REFERENCES actors(id),
        name TEXT NOT NULL CHECK (length(name) > 0),
        default_project_id TEXT REFERENCES projects(id),
        default_status TEXT CHECK (default_status IN ('backlog', 'ready', 'in_progress', 'blocked', 'done', 'canceled')),
        default_assignee_id TEXT REFERENCES actors(id),
        pinned_at TEXT,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX pads_owner ON pads(owner_id, archived_at, updated_at);

      -- block เรียงแบบ tree: order_key เรียงในกลุ่มพี่น้องที่มี parent เดียวกัน
      CREATE TABLE pad_blocks (
        id TEXT PRIMARY KEY,
        pad_id TEXT NOT NULL REFERENCES pads(id),
        type TEXT NOT NULL CHECK (type IN ('task', 'text', 'heading')),
        parent_id TEXT REFERENCES pad_blocks(id),
        order_key TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '[]',
        task_id TEXT UNIQUE REFERENCES tasks(id),
        collapsed INTEGER NOT NULL DEFAULT 0,
        previous_status TEXT,
        revision INTEGER NOT NULL DEFAULT 1,
        last_mutation_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK ((type = 'task') = (task_id IS NOT NULL)),
        CHECK (parent_id IS NULL OR parent_id <> id)
      ) STRICT;
      CREATE INDEX pad_blocks_siblings ON pad_blocks(pad_id, parent_id, order_key);
      CREATE INDEX pad_blocks_parent ON pad_blocks(parent_id);

      -- ผลลัพธ์ของ mutation ที่ client ส่ง mutationId มา: retry แล้วได้ผลเดิม ไม่สร้างซ้ำ
      CREATE TABLE pad_mutations (
        owner_id TEXT NOT NULL REFERENCES actors(id),
        mutation_id TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        response TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (owner_id, mutation_id)
      ) STRICT, WITHOUT ROWID;
      CREATE INDEX pad_mutations_created ON pad_mutations(created_at);

      -- index ค้นหาส่วนตัว แยกจาก search_index ของ workspace โดยสิ้นเชิง
      CREATE TABLE pad_search_docs (
        rowid INTEGER PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES actors(id),
        pad_id TEXT NOT NULL REFERENCES pads(id),
        block_id TEXT REFERENCES pad_blocks(id),
        UNIQUE (pad_id, block_id)
      ) STRICT;
      CREATE INDEX pad_search_docs_owner ON pad_search_docs(owner_id);
      CREATE UNIQUE INDEX pad_search_docs_name ON pad_search_docs(pad_id) WHERE block_id IS NULL;
      CREATE VIRTUAL TABLE pad_search_index USING fts5(body, tokenize = 'trigram remove_diacritics 1');

      -- event ส่วนตัวส่งเฉพาะ session ของ audience และไม่ replay ให้ actor อื่น
      ALTER TABLE client_events ADD COLUMN audience_id TEXT;
      ALTER TABLE client_events ADD COLUMN origin TEXT;
    `,
  },
  {
    version: 12,
    name: 'local_workspaces',
    sql: `
      -- Local workspaces: capability ที่ daemon ตรวจ เก็บเฉพาะ hash; ตัว secret อยู่ใน OS credential store
      CREATE TABLE local_capabilities (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL REFERENCES actors(id),
        purpose TEXT NOT NULL CHECK (purpose IN ('owner', 'agent')),
        secret_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        last_used_at TEXT,
        revoked_at TEXT
      ) STRICT;
      CREATE INDEX local_capabilities_actor ON local_capabilities(actor_id);

      -- agent ของเครื่อง (Codex, Claude) ผูกกับ integration id ระดับเครื่องที่คงที่
      CREATE TABLE local_integrations (
        client TEXT PRIMARY KEY CHECK (client IN ('codex', 'claude-code')),
        integration_id TEXT NOT NULL UNIQUE,
        actor_id TEXT NOT NULL UNIQUE REFERENCES actors(id),
        enabled_at TEXT,
        disabled_at TEXT
      ) STRICT;
    `,
  },
]

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version
