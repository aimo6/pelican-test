/**
 * API Key 的 Base64 编解码工具。
 *
 * ⚠️ 重要说明（请勿误读）
 * Base64 只是一种「编码」方式，不是加密，也不提供任何保密能力。
 * 它只是把 Key 从明文变成另一种可逆的文本形式，任何能够访问本页面运行环境、
 * 浏览器存储（IndexedDB / DevTools / 本地磁盘 Profile）的人，都可以把它还原成原始 API Key。
 *
 * 本项目的目标只是「避免 Key 以肉眼可读的明文形式直接落在浏览器存储里」，
 * 不构成任何安全防护。如果未来要公开部署或面向多人使用，
 * 必须另外设计真正的密钥保护与访问控制方案（例如由服务端代理请求、密钥托管在服务端 KMS 等）。
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * 把字节数组转成 Base64 字符串（分块处理，避免超长参数导致栈溢出）。
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

/**
 * 把 Base64 字符串还原成字节数组。
 * @param {string} base64
 * @returns {Uint8Array}
 */
function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * 编码 API Key（支持非 ASCII 字符，使用 UTF-8 字节序列）。
 * @param {string} plain
 * @returns {string} Base64 文本；空输入返回空字符串
 */
export function encodeApiKey(plain) {
  if (typeof plain !== 'string' || plain.length === 0) return '';
  return bytesToBase64(encoder.encode(plain));
}

/**
 * 解码 API Key。仅在真正发起请求前调用。
 * 解码失败（数据损坏）时返回空字符串，避免把异常抛到 UI 层。
 * @param {string} encoded
 * @returns {string}
 */
export function decodeApiKey(encoded) {
  if (typeof encoded !== 'string' || encoded.length === 0) return '';
  try {
    return decoder.decode(base64ToBytes(encoded));
  } catch (error) {
    return '';
  }
}

/**
 * 生成用于界面展示的 Key 掩码，例如 `sk-••••••1a2b`。
 * 只保留极少量首尾字符，禁止在 UI 或日志中输出完整 Key。
 * @param {string} plain 明文 Key（仅在内存中短暂存在）
 * @returns {string}
 */
export function maskApiKey(plain) {
  if (!plain) return '（未设置）';
  const text = String(plain);
  if (text.length <= 8) return '••••••';
  return `${text.slice(0, 3)}••••••${text.slice(-4)}`;
}

/**
 * 从任意文本中抹掉指定的密钥，用于错误信息、日志等输出前的兜底处理。
 * @param {string} text
 * @param {string} secret 需要抹除的明文密钥
 * @returns {string}
 */
export function redactSecret(text, secret) {
  if (!text) return '';
  const source = String(text);
  if (!secret || secret.length < 4) return source;
  return source.split(secret).join('••••••');
}
