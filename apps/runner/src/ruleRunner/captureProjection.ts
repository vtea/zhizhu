/**
 * Runner 结案输出前的抓包投影：抖音视频/SEO 列表/详情接口体常 50KB–1MB 级、
 * `accumulate=true` 滚动多页后单键累积可破 10MB，再加上单进程一次 task-rule 输出一行 JSON，
 * Electron 端 readline 在大行下会因 pipe 缓冲/反压在窗口环境**整行解析失败**，
 * 表现为 `Runner done 行 JSON 无法解析（可能因单行过大或截断）`。
 *
 * 这里对**已知**业务视频类抓包键应用白名单投影（仅保留 `employeePersonalAuthFileIngest` 与
 * `bizVideoCaptureCoverage` / `buildCaptureDiagnostics` 实际读取的字段），其它键（如线索/高潜）
 * **原样**透传，避免影响其它规则。
 *
 * 投影位置：`cli.ts cmdTaskRule` 在序列化 `done` 行之前一次性应用；运行中的 CaptureBucket 不变，
 * 因此 `wait { response_key }` / `accumulate_grow_by` / 诊断聚合等等待逻辑不受影响。
 */

/** 与客户端 `BIZ_VIDEO_FLAT_CAPTURE_TOP_KEYS` 对齐 + SEO 内链键，扩展时两边同步。 */
const BIZ_VIDEO_PROJECTABLE_KEYS = new Set<string>([
  "dy_latest_video_payload",
  "dy_video_list_payload",
  "video_list_payload",
  "dy_video_detail_payload",
  "video_detail_payload",
  "dy_seo_inner_link_payload",
]);

const AWEME_TOP_LEVEL_KEEP = new Set<string>([
  "aweme_id",
  "awemeId",
  "video_id",
  "item_id",
  "dy_video_id",
  "desc",
  "dy_title",
  "title",
  "create_time",
  "aweme_create_time",
  "publish_time",
  "dy_publish_at",
  "createTime",
  "publishTime",
  "share_url",
  "video_url",
  "dy_video_url",
  "cover_url",
  "aweme_type",
  "image_post",
  "duration",
  "dy_duration_sec",
  "play_count",
  "like_count",
  "comment_count",
  "favorite_count",
  "share_count",
  "dy_play_count",
  "dy_like_count",
  "dy_comment_count",
  "dy_favorite_count",
  "dy_share_count",
]);

const AUTHOR_KEEP = new Set<string>([
  "uid",
  "user_id",
  "unique_id",
  "uniqueId",
  "short_id",
  "sec_uid",
  "secUid",
  "nickname",
]);

/** 统计与 `mergeAwemeStatsObjects` 一致——同名键以 statistics 为准；这里只投影常用字段，未列出的丢弃。 */
const STATS_KEEP = new Set<string>([
  "play_count",
  "aweme_play_count",
  "digg_count",
  "comment_count",
  "collect_count",
  "share_count",
  "like_count",
  "favorite_count",
]);

const MUSIC_KEEP = new Set<string>([
  "title",
  "author",
  "music_title",
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function projectAuthor(author: unknown): unknown {
  if (!isPlainObject(author)) {
    return author;
  }
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(author)) {
    if (AUTHOR_KEEP.has(k)) {
      out[k] = author[k];
    }
  }
  return out;
}

function projectStatsLike(o: unknown): unknown {
  if (!isPlainObject(o)) {
    return o;
  }
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o)) {
    if (STATS_KEEP.has(k)) {
      out[k] = o[k];
    }
  }
  return out;
}

function projectMusic(o: unknown): unknown {
  if (!isPlainObject(o)) {
    return o;
  }
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o)) {
    if (MUSIC_KEEP.has(k)) {
      out[k] = o[k];
    }
  }
  return out;
}

/** 仅保留 `url_list` 第 1 个非空 URL；下游 cover / playable 流检测都只用 `some(u.includes("http"))`。 */
function projectUrlListContainer(o: unknown): unknown {
  if (!isPlainObject(o)) {
    return o;
  }
  const list = o.url_list;
  if (!Array.isArray(list)) {
    return {};
  }
  const first = list.find((u) => typeof u === "string" && u.length > 0);
  return { url_list: first !== undefined ? [first] : [] };
}

/**
 * `video` 块投影：保留 `duration`、`cover.url_list[0]`、`play_addr.url_list[0]`、`download_addr.url_list[0]`，
 * `bit_rate` 仅保留是否非空（`videoObjHasPlayableStream` 只检查 `Array.isArray && length > 0`）。
 *
 * 这是单条 aweme 内最大的节流来源：原 `bit_rate` 数组每元素自带 `play_addr.url_list`（含 5–15 个 CDN 链接
 * + 鉴权参数），再叠 4K/1080P/720P/480P 多档常 50–200KB；详情接口的 `dynamic_cover` / `origin_cover` /
 * 多分辨率封面同样冗长。
 */
function projectVideo(v: unknown): unknown {
  if (!isPlainObject(v)) {
    return v;
  }
  const out: Record<string, unknown> = {};
  if ("duration" in v) {
    out.duration = v.duration;
  }
  if ("cover" in v) {
    out.cover = projectUrlListContainer(v.cover);
  }
  if ("play_addr" in v) {
    out.play_addr = projectUrlListContainer(v.play_addr);
  }
  if ("download_addr" in v) {
    out.download_addr = projectUrlListContainer(v.download_addr);
  }
  /** bit_rate 仅长度参与判定 `hasStream`；存空对象避免拉出每档完整 play_addr */
  if (Array.isArray(v.bit_rate)) {
    out.bit_rate = v.bit_rate.length > 0 ? [{}] : [];
  }
  return out;
}

function projectImages(v: unknown): unknown {
  /**
   * `looksLikeImageAlbumWithoutPlayableVideo` 只检查 `Array.isArray(images) && length > 0`，
   * 不读单个 image 的内容；保留一个占位即可。
   */
  if (!Array.isArray(v)) {
    return v;
  }
  return v.length > 0 ? [{}] : [];
}

/** 单条 aweme（列表项或详情对象）投影。未识别的对象**原样返回**（避免误伤）。 */
function projectAweme(obj: unknown): unknown {
  if (!isPlainObject(obj)) {
    return obj;
  }
  /** 仅当对象长得像 aweme（有 aweme_id / awemeId / video_id / item_id 之一）时才投影；其它子对象原样返回。 */
  const looksAweme =
    Object.prototype.hasOwnProperty.call(obj, "aweme_id") ||
    Object.prototype.hasOwnProperty.call(obj, "awemeId") ||
    Object.prototype.hasOwnProperty.call(obj, "video_id") ||
    Object.prototype.hasOwnProperty.call(obj, "item_id") ||
    Object.prototype.hasOwnProperty.call(obj, "dy_video_id");
  if (!looksAweme) {
    return obj;
  }
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj)) {
    if (AWEME_TOP_LEVEL_KEEP.has(k)) {
      out[k] = obj[k];
      continue;
    }
    if (k === "author") {
      out.author = projectAuthor(obj.author);
      continue;
    }
    if (k === "stats" || k === "statistics") {
      out[k] = projectStatsLike(obj[k]);
      continue;
    }
    if (k === "music") {
      out.music = projectMusic(obj.music);
      continue;
    }
    if (k === "video") {
      out.video = projectVideo(obj.video);
      continue;
    }
    if (k === "images") {
      out.images = projectImages(obj.images);
      continue;
    }
    /** 其它键（text_extra / risk_infos / cha_list / status / log_pb / share_info 等）丢弃 */
  }
  return out;
}

/** `link_data[].link_list[]` 仅 url / anchor 入库；`link_type` 决定是否跳过该 block。 */
function projectSeoLinkData(linkData: unknown): unknown {
  if (!Array.isArray(linkData)) {
    return linkData;
  }
  const out: unknown[] = [];
  for (const block of linkData) {
    if (!isPlainObject(block)) {
      continue;
    }
    const slim: Record<string, unknown> = {};
    if ("link_type" in block) {
      slim.link_type = block.link_type;
    }
    if (Array.isArray(block.link_list)) {
      slim.link_list = block.link_list.map((item) => {
        if (!isPlainObject(item)) {
          return item;
        }
        const o: Record<string, unknown> = {};
        if (typeof item.url === "string") {
          o.url = item.url;
        }
        if (typeof item.anchor === "string") {
          o.anchor = item.anchor;
        }
        return o;
      });
    }
    out.push(slim);
  }
  return out;
}

/**
 * 单个响应体投影：根据顶层键判断类型——视频列表 / 详情 / SEO 内链；保留少量分页/调试字段
 * （`has_more`/`max_cursor` 仅几十字节，不影响入库但有助试跑判断）。
 */
function projectOneResponseForBizVideoKey(key: string, payload: unknown): unknown {
  if (payload === null || payload === undefined) {
    return payload;
  }
  if (Array.isArray(payload)) {
    /** 罕见但合法：响应直接是 aweme 数组 */
    return payload.map(projectAweme);
  }
  if (!isPlainObject(payload)) {
    return payload;
  }
  if (key === "dy_seo_inner_link_payload") {
    const out: Record<string, unknown> = {};
    if ("status_code" in payload) {
      out.status_code = payload.status_code;
    }
    if (Array.isArray(payload.link_data)) {
      out.link_data = projectSeoLinkData(payload.link_data);
    }
    /** 抖音 SEO 接口也常嵌一层 `data.link_data` */
    if (isPlainObject(payload.data)) {
      const d = payload.data;
      const slimData: Record<string, unknown> = {};
      if (Array.isArray(d.link_data)) {
        slimData.link_data = projectSeoLinkData(d.link_data);
      }
      out.data = slimData;
    }
    return out;
  }
  /** 列表/详情体：常见根形态 */
  const out: Record<string, unknown> = {};
  /** 仅保留少量低成本元数据，便于诊断；下游入库不依赖 */
  for (const k of ["has_more", "max_cursor", "min_cursor", "cursor", "status_code", "total"]) {
    if (k in payload) {
      out[k] = (payload as Record<string, unknown>)[k];
    }
  }
  if (Array.isArray(payload.aweme_list)) {
    out.aweme_list = payload.aweme_list.map(projectAweme);
  }
  if (isPlainObject(payload.aweme_detail)) {
    out.aweme_detail = projectAweme(payload.aweme_detail);
  }
  if (isPlainObject(payload.aweme_info)) {
    out.aweme_info = projectAweme(payload.aweme_info);
  }
  if (isPlainObject(payload.data)) {
    const slimData: Record<string, unknown> = {};
    const d = payload.data;
    if (Array.isArray(d.aweme_list)) {
      slimData.aweme_list = d.aweme_list.map(projectAweme);
    }
    if (isPlainObject(d.aweme_detail)) {
      slimData.aweme_detail = projectAweme(d.aweme_detail);
    }
    if (isPlainObject(d.aweme_info)) {
      slimData.aweme_info = projectAweme(d.aweme_info);
    }
    if (Object.keys(slimData).length > 0) {
      out.data = slimData;
    }
  }
  /** 极少数响应直接把单条 aweme 放根；fallback 走 projectAweme 探测 */
  if (
    Object.keys(out).length === 0 &&
    (Object.prototype.hasOwnProperty.call(payload, "aweme_id") ||
      Object.prototype.hasOwnProperty.call(payload, "awemeId"))
  ) {
    return projectAweme(payload);
  }
  return out;
}

/**
 * 顶层 captures 投影：
 * - 已知业务视频键（{@link BIZ_VIDEO_PROJECTABLE_KEYS}）按累加/单值递归投影；
 * - 其它键原样透传（包括 `dy_profile_works_count_dom` 等小标量）。
 *
 * 注意：本函数返回**新对象**，不修改入参；调用方保留原始 captureBucket 即可。
 */
export function projectCapturesForBizVideoRunnerOutput(
  captures: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(captures)) {
    const v = captures[key];
    if (!BIZ_VIDEO_PROJECTABLE_KEYS.has(key)) {
      out[key] = v;
      continue;
    }
    if (Array.isArray(v)) {
      out[key] = v.map((one) => projectOneResponseForBizVideoKey(key, one));
    } else {
      out[key] = projectOneResponseForBizVideoKey(key, v);
    }
  }
  return out;
}

/** 仅暴露给单元测试，便于断言；不必加入 index.ts。 */
export const __projectionInternals = {
  projectAweme,
  projectSeoLinkData,
  projectOneResponseForBizVideoKey,
  BIZ_VIDEO_PROJECTABLE_KEYS,
};
