-- 独立新增员工账号主页字段，避免与历史 dy_profile_url 混用语义。
ALTER TABLE biz_account
  ADD COLUMN IF NOT EXISTS dy_user_url text;

-- 兼容历史数据：仅在新字段为空时，从旧字段回填一次。
UPDATE biz_account
SET dy_user_url = dy_profile_url
WHERE dy_user_url IS NULL
  AND dy_profile_url IS NOT NULL;
