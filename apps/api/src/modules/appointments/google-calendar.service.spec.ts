/// <reference types="jest" />
import { ServiceUnavailableException } from '@nestjs/common';
import { AppointmentMode } from '@prisma/client';
import { GoogleCalendarService } from './google-calendar.service';

describe('GoogleCalendarService', () => {
  const originalEnvironment = {
    GOOGLE_CALENDAR_CLIENT_ID: process.env.GOOGLE_CALENDAR_CLIENT_ID,
    GOOGLE_CALENDAR_CLIENT_SECRET: process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
    GOOGLE_CALENDAR_REFRESH_TOKEN: process.env.GOOGLE_CALENDAR_REFRESH_TOKEN,
    GOOGLE_CALENDAR_ADMIN_EMAIL: process.env.GOOGLE_CALENDAR_ADMIN_EMAIL,
    GOOGLE_CALENDAR_ID: process.env.GOOGLE_CALENDAR_ID
  };
  const service = new GoogleCalendarService();

  beforeEach(() => {
    process.env.GOOGLE_CALENDAR_CLIENT_ID = 'oauth-client-id';
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET = 'oauth-client-secret';
    process.env.GOOGLE_CALENDAR_REFRESH_TOKEN = 'oauth-refresh-token';
    process.env.GOOGLE_CALENDAR_ADMIN_EMAIL = 'adminlandtrack@gmail.com';
    process.env.GOOGLE_CALENDAR_ID = 'primary';
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    jest.restoreAllMocks();
  });

  it('creates a Meet-enabled Calendar event and invites the customer', async () => {
    const fetch = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'google-access-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ email: 'adminlandtrack@gmail.com', email_verified: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'calendar-event-id', hangoutLink: 'https://meet.google.com/abc-defg-hij' }), { status: 200 }));

    await expect(service.createAppointment({
      appointmentId: 'appointment-id',
      propertyName: 'Test property',
      nriName: 'NRI Customer',
      nriEmail: 'customer@example.com',
      mode: AppointmentMode.VIDEO,
      startUtc: new Date('2026-10-20T04:30:00.000Z'),
      endUtc: new Date('2026-10-20T05:00:00.000Z')
    })).resolves.toEqual({ eventId: 'calendar-event-id', meetUrl: 'https://meet.google.com/abc-defg-hij' });

    expect(fetch).toHaveBeenCalledTimes(3);
    const [eventUrl, eventOptions] = fetch.mock.calls[2];
    expect(eventUrl).toContain('/calendars/primary/events?sendUpdates=all&conferenceDataVersion=1');
    const requestBody = JSON.parse(String(eventOptions?.body)) as {
      attendees: Array<{ email: string }>;
      conferenceData: { createRequest: { conferenceSolutionKey: { type: string } } };
    };
    expect(requestBody.attendees).toEqual([{ email: 'customer@example.com' }]);
    expect(requestBody.conferenceData.createRequest.conferenceSolutionKey.type).toBe('hangoutsMeet');
  });

  it('refuses to create an event if OAuth belongs to another Google account', async () => {
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'google-access-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ email: 'someone-else@gmail.com', email_verified: true }), { status: 200 }));

    await expect(service.createAppointment({
      appointmentId: 'appointment-id',
      propertyName: 'Test property',
      nriName: 'NRI Customer',
      nriEmail: 'customer@example.com',
      mode: AppointmentMode.SITE_VISIT,
      startUtc: new Date('2026-10-20T04:30:00.000Z'),
      endUtc: new Date('2026-10-20T05:00:00.000Z')
    })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
