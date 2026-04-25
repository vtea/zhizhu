import { PageHeader } from "@/components/PageHeader";
import { getSmtpConfigStatus, mailStatusAvailable } from "@/api/mail";
import { useSession } from "@/hooks/useSession";
import { useTenantId } from "@/hooks/useTenantId";
import { formatQueryError } from "@/lib/queryError";
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";

function Flag({ ok }: { ok: boolean }) {
  return <span className={ok ? "text-zz-blue" : "text-zz-muted"}>{ok ? "已配置" : "未配置"}</span>;
}

export function SmtpSettingsPage() {
  const tenantId = useTenantId();
  const session = useSession();
  const platformAdmin = session?.platformAdmin === true;
  const hasToken = Boolean(session?.accessToken);
  const canFetchSmtp = platformAdmin && hasToken;
  const api = mailStatusAvailable();
  const q = useQuery({
    queryKey: ["smtp-status", canFetchSmtp ? "y" : "n"],
    queryFn: () => getSmtpConfigStatus(),
    enabled: api && canFetchSmtp,
    staleTime: 30_000,
  });

  if (!platformAdmin) {
    return <Navigate to={`/t/${encodeURIComponent(tenantId)}/system-settings/organization`} replace />;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        titleAs="h2"
        title="邮件（SMTP）"
        description="仅平台管理员可查看。发信参数由 API 部署环境统一配置。当前控制台账密登录不依赖本页；检测接口不返回任何密钥。"
      />

      <section className="rounded-[var(--radius-signature)] border border-zz-card-border bg-zz-white p-6 text-sm leading-relaxed text-zz-near">
        <h3 className="text-base font-semibold text-zz-black">如何配置</h3>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-zz-muted">
          <li>
            在部署 <strong>API 服务</strong> 的机器上编辑仓库根目录的 <code className="rounded bg-zz-snow px-1 font-mono text-zz-near">.env</code>（勿提交到 Git），或容器/平台的密钥管理里注入同名变量。
          </li>
          <li>
            填写下方列出的变量后，<strong>重启</strong> <code className="font-mono">@zhizhu/api</code> 进程使配置生效。
          </li>
          <li>本页「连接就绪检测」仅反映变量是否已设置，不会显示密码内容。</li>
        </ol>
      </section>

      <section className="rounded-[var(--radius-signature)] border border-zz-card-border bg-zz-white p-6">
        <h3 className="text-base font-semibold text-zz-black">环境变量清单</h3>
        <table className="mt-4 w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-zz-border-light text-zz-muted">
              <th className="py-2 pr-4 font-medium">变量名</th>
              <th className="py-2 pr-4 font-medium">说明</th>
            </tr>
          </thead>
          <tbody className="text-zz-near">
            <tr className="border-b border-zz-border-light">
              <td className="py-2 pr-4 font-mono text-xs">SMTP_HOST</td>
              <td className="py-2">SMTP 服务器主机名，例如 smtp.example.com</td>
            </tr>
            <tr className="border-b border-zz-border-light">
              <td className="py-2 pr-4 font-mono text-xs">SMTP_PORT</td>
              <td className="py-2">端口，常用 587（STARTTLS）或 465（TLS）</td>
            </tr>
            <tr className="border-b border-zz-border-light">
              <td className="py-2 pr-4 font-mono text-xs">SMTP_FROM</td>
              <td className="py-2">发件人地址（必须与服务商允许的发信身份一致）</td>
            </tr>
            <tr className="border-b border-zz-border-light">
              <td className="py-2 pr-4 font-mono text-xs">SMTP_USER</td>
              <td className="py-2">认证用户名（可与发件人不同）</td>
            </tr>
            <tr className="border-b border-zz-border-light">
              <td className="py-2 pr-4 font-mono text-xs">SMTP_PASSWORD</td>
              <td className="py-2">认证密码或应用专用密码</td>
            </tr>
            <tr className="border-b border-zz-border-light">
              <td className="py-2 pr-4 font-mono text-xs">SMTP_SECURE</td>
              <td className="py-2">可选，设为 <code className="font-mono">true</code> 时使用 TLS（如 465）</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-4 text-xs text-zz-muted">
          亦可在仓库根 <code className="font-mono">.env.example</code> 中查看注释模板；若使用内网中继无认证，可只配 HOST/PORT/FROM，并在实现发信逻辑时单独处理。
        </p>
      </section>

      <section className="rounded-[var(--radius-signature)] border border-zz-card-border bg-zz-white p-6">
        <h3 className="text-base font-semibold text-zz-black">连接就绪检测</h3>
        {api && !hasToken ? (
          <p className="mt-3 text-sm text-amber-900" role="status">
            当前会话无 JWT 访问令牌，无法拉取全站 SMTP 状态（与租户管理、登记租户等接口一致，需根目录
            <code className="mx-1 font-mono text-xs">JWT_SECRET</code> 与重启
            <code className="mx-1 font-mono text-xs">@zhizhu/api</code> 后使用平台账号重新登录）。
          </p>
        ) : null}
        {!api ? (
          <p className="mt-3 text-sm text-zz-muted">配置 VITE_API_BASE_URL 后自动拉取服务端检测（不含任何密钥明文）。</p>
        ) : canFetchSmtp && q.isError ? (
          <p className="mt-3 text-sm text-red-700">加载失败：{formatQueryError(q.error, "加载失败")}</p>
        ) : canFetchSmtp && q.isPending ? (
          <p className="mt-3 text-sm text-zz-muted">检测中…</p>
        ) : canFetchSmtp && q.data ? (
          <ul className="mt-4 space-y-2 text-sm">
            <li>
              SMTP_HOST：<Flag ok={q.data.smtp_host_set === true} />
            </li>
            <li>
              SMTP_PORT：<Flag ok={q.data.smtp_port_set === true} />
            </li>
            <li>
              SMTP_FROM：<Flag ok={q.data.smtp_from_set === true} />
            </li>
            <li>
              SMTP_USER：<Flag ok={q.data.smtp_user_set === true} />
            </li>
            <li>
              SMTP_PASSWORD：<Flag ok={q.data.smtp_password_set === true} />
            </li>
            <li className="pt-2 font-medium text-zz-near">
              综合（主机+端口+发件人）：
              {q.data.likely_ready === true ? (
                <span className="text-zz-blue">可进入发信实现阶段</span>
              ) : (
                <span className="text-zz-muted">尚不完整</span>
              )}
            </li>
          </ul>
        ) : null}
      </section>
    </div>
  );
}
