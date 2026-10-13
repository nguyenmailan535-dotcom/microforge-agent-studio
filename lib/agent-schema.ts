import { z } from "zod";
import { parse } from "acorn";

export const blueprintSchema = z.object({
  title: z.string().min(1).max(80),
  summary: z.string().min(1).max(500),
  audience: z.string().min(1).max(240),
  requirements: z.array(z.string().min(1)).min(2).max(14),
  dataModel: z.array(z.object({
    name: z.string().min(1).max(80),
    fields: z.array(z.object({
      name: z.string().min(1).max(80),
      type: z.string().min(1).max(50),
      required: z.boolean(),
    })).max(16),
  })).max(10),
  screens: z.array(z.object({
    name: z.string().min(1).max(80),
    purpose: z.string().min(1).max(240),
    actions: z.array(z.string().min(1)).max(12),
  })).min(1).max(12),
  acceptanceCriteria: z.array(z.string().min(1)).min(2).max(16),
  visualDirection: z.string().min(1).max(400),
});

export type Blueprint = z.infer<typeof blueprintSchema>;

export type ValidationCheck = {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
};

export function validateGeneratedHtml(html: string): ValidationCheck[] {
  const scripts = Array.from(html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi), (match) => match[1]);
  let validSyntax = scripts.length > 0;
  try {
    if (scripts.length) parse(scripts.join("\n"), { ecmaVersion: "latest" });
  } catch {
    validSyntax = false;
  }
  const checks: ValidationCheck[] = [
    check("document", "完整 HTML 文档", /<!doctype html/i.test(html) && /<html[\s>]/i.test(html) && /<\/html>/i.test(html), "包含 doctype、html 与完整闭合结构"),
    check("style", "自包含样式", /<style[\s>]/i.test(html), "使用内联 CSS，预览无需外部资源"),
    check("script", "具备交互逻辑", /<script[\s>]/i.test(html), "包含应用交互脚本"),
    check("syntax", "脚本语法有效", validSyntax, "内联 JavaScript 可被浏览器解析"),
    check("size", "源码体积可控", html.length <= 160_000, "完整源码不超过 160000 字符，便于后续持续迭代"),
    check("storage", "持久化桥接", /microforgeStore\.(get|set)/.test(html), "通过沙箱存储桥保存数据"),
    check("storage-boundary", "受控存储边界", !/\b(?:localStorage|sessionStorage|indexedDB)\b|document\.cookie/i.test(html), "仅通过 microforgeStore 读写数据，不直接访问浏览器存储"),
    check("offline", "无外部脚本或网络请求", !/<script[^>]+src=/i.test(html) && !/\b(fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/.test(html), "不加载外部脚本、不发起网络请求"),
    check("isolation", "未访问宿主页面", !/window\.(parent|top|opener)|document\.cookie/i.test(html), "不读取父窗口、顶层窗口或 Cookie"),
    check("clean", "无 Markdown 包裹", !/```/.test(html), "返回可直接运行的源码"),
  ];
  return checks;
}

function check(id: string, label: string, passed: boolean, detail: string): ValidationCheck {
  return { id, label, passed, detail };
}
