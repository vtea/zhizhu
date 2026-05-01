-- 视频页/分享短链（与封面图 dy_cover_url 分列）
ALTER TABLE biz_video ADD COLUMN IF NOT EXISTS dy_video_url text;
