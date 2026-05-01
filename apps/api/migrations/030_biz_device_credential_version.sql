-- Runner device token 校验：吊销仍用 revoked_at；轮换同机凭证时递增此处并拒绝旧 token.ver
ALTER TABLE biz_device ADD COLUMN IF NOT EXISTS device_credential_version int NOT NULL DEFAULT 1;
