-- 对齐 docs/数据字典-视频投放-示意.md §1：按日一行 + 同号同视频单条 current；挂 FK 至主数据
-- 升级路径：去掉无法匹配主数据的旧投放行，再建约束（避免 ADD CONSTRAINT 失败）

DELETE FROM biz_ad_placement p
WHERE NOT EXISTS (
    SELECT 1
    FROM biz_account a
    WHERE a.tenant_id = p.tenant_id
      AND a.platform = p.platform
      AND a.account_id = p.account_id
  )
   OR NOT EXISTS (
    SELECT 1
    FROM biz_video v
    WHERE v.tenant_id = p.tenant_id
      AND v.platform = p.platform
      AND v.dy_video_id = p.dy_video_id
  );

DROP INDEX IF EXISTS uq_biz_ad_placement_current;

CREATE UNIQUE INDEX IF NOT EXISTS uq_biz_ad_placement_day
  ON biz_ad_placement (tenant_id, platform, account_id, dy_video_id, ad_date);

CREATE UNIQUE INDEX IF NOT EXISTS uq_biz_ad_placement_current
  ON biz_ad_placement (tenant_id, platform, account_id, dy_video_id)
  WHERE is_current = true;

ALTER TABLE biz_ad_placement DROP CONSTRAINT IF EXISTS fk_biz_ad_placement_account;
ALTER TABLE biz_ad_placement
  ADD CONSTRAINT fk_biz_ad_placement_account
  FOREIGN KEY (tenant_id, platform, account_id)
  REFERENCES biz_account (tenant_id, platform, account_id);

ALTER TABLE biz_ad_placement DROP CONSTRAINT IF EXISTS fk_biz_ad_placement_video;
ALTER TABLE biz_ad_placement
  ADD CONSTRAINT fk_biz_ad_placement_video
  FOREIGN KEY (tenant_id, platform, dy_video_id)
  REFERENCES biz_video (tenant_id, platform, dy_video_id);
