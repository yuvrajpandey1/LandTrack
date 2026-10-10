import { Injectable } from '@nestjs/common';

@Injectable()
export class WhatsAppService {
  async sendTemplate(to: string, template: string, parameters: Record<string, string>): Promise<string> {
    if (process.env.WHATSAPP_PROVIDER === 'fake') {
      console.info(`Sandbox WhatsApp template queued: ${template}`);
      return `sandbox_${Date.now()}`;
    }
    const response = await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN!}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to.replace('+', ''),
        type: 'template',
        template: {
          name: template,
          language: { code: 'en' },
          components: [{ type: 'body', parameters: Object.values(parameters).map((text) => ({ type: 'text', text })) }]
        }
      })
    });
    const result: unknown = await response.json();
    if (!response.ok || !result || typeof result !== 'object' || !('messages' in result)) {
      throw new Error(`WhatsApp provider rejected the message (${response.status}).`);
    }
    const messages = (result as { messages: Array<{ id: string }> }).messages;
    if (!messages[0]?.id) throw new Error('WhatsApp provider returned no message identifier.');
    return messages[0].id;
  }
}
