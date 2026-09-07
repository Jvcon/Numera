import { Env } from '../types';

// 邮件发送接口
interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

// 使用 Resend 发送邮件
async function sendWithResend(
  options: EmailOptions,
  env: Env
): Promise<boolean> {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) return false;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      }),
    });

    return response.ok;
  } catch {
    return false;
  }
}

// 使用 Mailchannels 发送邮件（Cloudflare Workers 集成）
async function sendWithMailchannels(
  options: EmailOptions,
  env: Env
): Promise<boolean> {
  try {
    const response = await fetch('https://api.mailchannels.net/tx/v1/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [
          {
            to: [{ email: options.to }],
          },
        ],
        from: {
          email: env.MAIL_FROM,
          name: 'Numera',
        },
        subject: options.subject,
        content: [
          {
            type: 'text/plain',
            value: options.text,
          },
          {
            type: 'text/html',
            value: options.html,
          },
        ],
      }),
    });

    return response.ok;
  } catch {
    return false;
  }
}

// 发送 Magic Link 邮件
export async function sendMagicLinkEmail(
  email: string,
  magicLink: string,
  env: Env
): Promise<boolean> {
  const subject = '登录 Numera';
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; margin-bottom: 30px;">
        <h1 style="color: #2563eb; margin: 0;">Numera</h1>
        <p style="color: #6b7280; margin-top: 5px;">多端自然语言文本计算器</p>
      </div>
      
      <div style="background: #f9fafb; border-radius: 8px; padding: 24px; margin-bottom: 24px;">
        <p style="margin: 0 0 16px 0;">点击下面的按钮登录您的账号：</p>
        
        <div style="text-align: center;">
          <a href="${magicLink}" 
             style="display: inline-block; background: #2563eb; color: white; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-weight: 500;">
            登录 Numera
          </a>
        </div>
        
        <p style="margin: 16px 0 0 0; font-size: 14px; color: #6b7280;">
          此链接将在 15 分钟后过期。如果您没有请求此邮件，请忽略它。
        </p>
      </div>
      
      <div style="font-size: 12px; color: #9ca3af; text-align: center;">
        <p>如果按钮无法点击，请复制以下链接到浏览器：</p>
        <p style="word-break: break-all;">${magicLink}</p>
      </div>
    </body>
    </html>
  `;
  const text = `登录 Numera\n\n点击以下链接登录您的账号：\n${magicLink}\n\n此链接将在 15 分钟后过期。`;

  const options: EmailOptions = {
    to: email,
    subject,
    html,
    text,
  };

  // 优先使用 Resend，失败时使用 Mailchannels
  return (await sendWithResend(options, env)) || sendWithMailchannels(options, env);
}
