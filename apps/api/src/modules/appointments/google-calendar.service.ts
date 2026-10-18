import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AppointmentMode } from '@prisma/client';
import { randomUUID } from 'node:crypto';

interface GoogleTokenResponse {
  access_token?: string;
}

interface GoogleUserInfo {
  email?: string;
  email_verified?: boolean;
  verified_email?: boolean;
}

interface GoogleCalendarEvent {
  id?: string;
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
  };
}

interface CalendarBooking {
  appointmentId: string;
  propertyName: string;
  nriName: string;
  nriEmail: string;
  mode: AppointmentMode;
  startUtc: Date;
  endUtc: Date;
}

@Injectable()
export class GoogleCalendarService {
  private readonly apiBase = 'https://www.googleapis.com/calendar/v3';

  isConfigured(): boolean {
    return Boolean(
      process.env.GOOGLE_CALENDAR_CLIENT_ID &&
      process.env.GOOGLE_CALENDAR_CLIENT_SECRET &&
      process.env.GOOGLE_CALENDAR_REFRESH_TOKEN
    );
  }

  async createAppointment(booking: CalendarBooking): Promise<{ eventId: string; meetUrl: string | null }> {
    const token = await this.accessToken();
    const calendarId = encodeURIComponent(process.env.GOOGLE_CALENDAR_ID || 'primary');
    const conferenceData = booking.mode === AppointmentMode.VIDEO
      ? { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } }
      : undefined;
    const response = await this.request(
      `${this.apiBase}/calendars/${calendarId}/events?sendUpdates=all&conferenceDataVersion=1`,
      token,
      'POST',
      {
        summary: `LandTrack appointment - ${booking.propertyName}`,
        description: `LandTrack appointment reference: ${booking.appointmentId}\nCustomer: ${booking.nriName}`,
        start: { dateTime: booking.startUtc.toISOString(), timeZone: 'Asia/Kolkata' },
        end: { dateTime: booking.endUtc.toISOString(), timeZone: 'Asia/Kolkata' },
        attendees: [{ email: booking.nriEmail }],
        ...(conferenceData ? { conferenceData } : {})
      }
    );
    const created = await this.parseEvent(response);
    if (!created.id) throw new ServiceUnavailableException({ code: 'GOOGLE_CALENDAR_EVENT_FAILED', message: 'Google Calendar did not return an event ID. No appointment confirmation was issued.' });

    const meetUrl = booking.mode === AppointmentMode.VIDEO
      ? await this.findMeetUrl(token, calendarId, created.id, created)
      : null;
    if (booking.mode === AppointmentMode.VIDEO && !meetUrl) {
      await this.deleteEvent(created.id);
      throw new ServiceUnavailableException({ code: 'GOOGLE_MEET_CREATION_FAILED', message: 'Google Calendar created the event but did not return a Google Meet link. Please try booking again.' });
    }
    return { eventId: created.id, meetUrl };
  }

  async deleteEvent(eventId: string): Promise<void> {
    const token = await this.accessToken();
    const calendarId = encodeURIComponent(process.env.GOOGLE_CALENDAR_ID || 'primary');
    const response = await fetch(`${this.apiBase}/calendars/${calendarId}/events/${encodeURIComponent(eventId)}?sendUpdates=all`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok && response.status !== 404 && response.status !== 410) {
      throw new ServiceUnavailableException({ code: 'GOOGLE_CALENDAR_EVENT_DELETE_FAILED', message: 'The Google Calendar event could not be cancelled. Please retry or contact the administrator.' });
    }
  }

  private async accessToken(): Promise<string> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException({ code: 'GOOGLE_CALENDAR_NOT_CONFIGURED', message: 'Google Calendar booking is not configured. An administrator must connect the admin Google account before appointments can be booked.' });
    }
    const body = new URLSearchParams({
      client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET!,
      refresh_token: process.env.GOOGLE_CALENDAR_REFRESH_TOKEN!,
      grant_type: 'refresh_token'
    });
    let response: Response;
    try {
      response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(10_000)
      });
    } catch {
      throw new ServiceUnavailableException({ code: 'GOOGLE_AUTH_UNAVAILABLE', message: 'Google authorization could not be reached. No appointment was booked.' });
    }
    if (!response.ok) {
      throw new ServiceUnavailableException({ code: 'GOOGLE_AUTH_FAILED', message: 'Google authorization failed. Verify that the admin account has granted calendar access.' });
    }
    const token = await response.json() as GoogleTokenResponse;
    if (typeof token.access_token !== 'string' || !token.access_token) {
      throw new ServiceUnavailableException({ code: 'GOOGLE_AUTH_FAILED', message: 'Google authorization did not return an access token.' });
    }
    const identityResponse = await this.request('https://openidconnect.googleapis.com/v1/userinfo', token.access_token, 'GET');
    const identity = await identityResponse.json() as GoogleUserInfo;
    const adminEmail = (process.env.GOOGLE_CALENDAR_ADMIN_EMAIL || 'adminlandtrack@gmail.com').toLowerCase();
    if (!(identity.email_verified ?? identity.verified_email) || identity.email?.toLowerCase() !== adminEmail) {
      throw new ServiceUnavailableException({ code: 'GOOGLE_ADMIN_ACCOUNT_MISMATCH', message: `Google Calendar must be authorized as ${adminEmail}.` });
    }
    return token.access_token;
  }

  private async request(url: string, token: string, method: 'POST' | 'GET', body?: object): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(10_000)
      });
    } catch {
      throw new ServiceUnavailableException({ code: 'GOOGLE_CALENDAR_UNAVAILABLE', message: 'Google Calendar could not be reached. No appointment was booked.' });
    }
    if (!response.ok) {
      throw new ServiceUnavailableException({ code: 'GOOGLE_CALENDAR_REQUEST_FAILED', message: `Google Calendar rejected the request (HTTP ${response.status}). No appointment confirmation was issued.` });
    }
    return response;
  }

  private async parseEvent(response: Response): Promise<GoogleCalendarEvent> {
    return response.json() as Promise<GoogleCalendarEvent>;
  }

  private async findMeetUrl(token: string, calendarId: string, eventId: string, event: GoogleCalendarEvent): Promise<string | null> {
    const directLink = event.hangoutLink ?? event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === 'video')?.uri;
    if (directLink) return directLink;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const response = await this.request(
        `${this.apiBase}/calendars/${calendarId}/events/${encodeURIComponent(eventId)}`,
        token,
        'GET'
      );
      const updated = await this.parseEvent(response);
      const meetUrl = updated.hangoutLink ?? updated.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === 'video')?.uri;
      if (meetUrl) return meetUrl;
    }
    return null;
  }
}
