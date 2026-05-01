import { PageHeader } from "@/components/PageHeader";
import { Banner, Pill, SectionCard } from "@/components/ui";
import { getSmtpConfigStatus, mailStatusAvailable } from "@/api/mail";
import { useSession } from "@/hooks/useSession";
import { useTenantId } from "@/hooks/useTenantId";
import { formatQueryError } from "@/lib/queryError";
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";

function Flag({ ok }: { ok: boolean }) {
  return ok ? <Pill tone="success">已配置</Pill> : <Pill tone="neutral">未配置</Pill>;
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
      />

      <SectionCard title="如何配置" titleAs="h2">
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-zz-muted">
          <li>
            在部署 <strong>API 服务</strong> 的机器上编辑仓库根目录的{" "}
            <code className="rounded bg-zz-snow px-1 font-mono text-zz-near">.env</code>（勿提交到 Git），或容器/平台的密钥管理里注入同名变量。
          </li>
          <li>
            填写下方列出的变量后，<strong>重启</strong> <code className="font-mono">@zhizhu/api</code> 进程使配置生效。
          </li>
          <li>本页「连接就绪检测」仅反映变量是否已设置，不会显示密码内容。</li>
        </ol>
      </SectionCard>

      <SectionCard title="环境变量清单" titleAs="h2">
        <div className="-mx-6 overflow-x-auto">
          <table className="zz-table">
            <thead>
              <tr>
                <th>变量名</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="font-mono text-xs">SMTP_HOST</td>
                <td>SMTP 服务器主机名，例如 smtp.example.com</td>
              </tr>
              <tr>
                <td className="font-mono text-xs">SMTP_PORT</td>
                <td>端口，常用 587（STARTTLS）或 465（TLS）</td>
              </tr>
              <tr>
                <td className="font-mono text-xs">SMTP_FROM</td>
                <td>发件人地址（必须与服务商允许的发信身份一致）</td>
              </tr>
              <tr>
                <td className="font-mono text-xs">SMTP_USER</td>
                <td>认证用户名（可与发件人不同）</td>
              </tr>
              <tr>
                <td className="font-mono text-xs">SMTP_PASSWORD</td>
                <td>认证密码或应用专用密码</td>
              </tr>
              <tr>
                <td className="font-mono text-xs">SMTP_SECURE</td>
                <td>
                  可选，设为 <code className="font-mono">true</code> 时使用 TLS（如 465）
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-xs text-zz-muted">
          亦可在仓库根 <code className="font-mono">.env.example</code> 中查看注释模板；若使用内网中继无认证，可只配 HOST/PORT/FROM，并在实现发信逻辑时单独处理。
        </p>
      </SectionCard>

      <SectionCard title="连接就绪检测" titleAs="h2">
        {api && !hasToken ? (
          <Banner kind="warn">
            当前会话无 JWT 访问令牌，无法拉取全站 SMTP 状态（与租户管理、登记租户等接口一致，需根目录
            <code className="mx-1 font-mono text-xs">JWT_SECRET</code> 与重启
            <code className="mx-1 font-mono text-xs">@zhizhu/api</code> 后使用平台账号重新登录）。
          </Banner>
        ) : null}
        {!api ? (
          <p className="text-sm text-zz-muted">配置 VITE_API_BASE_URL 后自动拉取服务端检测（不含任何密钥明文）。</p>
        ) : canFetchSmtp && q.isError ? (
          <Banner kind="error">加载失败：{formatQueryError(q.error, "加载失败")}</Banner>
        ) : canFetchSmtp && q.isPending ? (
          <p className="text-sm text-zz-muted">检测中…</p>
        ) : canFetchSmtp && q.data ? (
          <ul className="space-y-2 text-sm">
            <li className="flex items-center gap-2">SMTP_HOST：<Flag ok={q.data.smtp_host_set === true} /></li>
            <li className="flex items-center gap-2">SMTP_PORT：<Flag ok={q.data.smtp_port_set === true} /></li>
            <li className="flex items-center gap-2">SMTP_FROM：<Flag ok={q.data.smtp_from_set === true} /></li>
            <li className="flex items-center gap-2">SMTP_USER：<Flag ok={q.data.smtp_user_set === true} /></li>
            <li className="flex items-center gap-2">SMTP_PASSWORD：<Flag ok={q.data.smtp_password_set === true} /></li>
            <li className="pt-2 font-medium text-zz-near">
              综合（主机+端口+发件人）：
              {q.data.likely_ready === true ? (
                <span className="ml-1 text-zz-blue">可进入发信实现阶段</span>
              ) : (
                <span className="ml-1 text-zz-muted">尚不完整</span>
              )}
            </li>
          </ul>
        ) : null}
      </SectionCard>
    </div>
  );
}
