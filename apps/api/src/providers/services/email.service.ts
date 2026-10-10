import { Injectable } from '@nestjs/common';
import nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly transport = nodemailer.createTransport(process.env.SMTP_URL!);

  async send(to: string, subject: string, text: string): Promise<void> {
    await this.transport.sendMail({
      from: process.env.MAIL_FROM!,
      to,
      subject,
      text
    });
  }
}
