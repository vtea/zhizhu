-- 对齐 docs/数据字典-任务与设备.md §5
CREATE TABLE IF NOT EXISTS biz_task_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES biz_task (id) ON DELETE CASCADE,
  seq int NOT NULL,
  event_type text NOT NULL,
  message text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_biz_task_run_task ON biz_task_run (task_id, seq);
